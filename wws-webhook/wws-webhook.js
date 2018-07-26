
var rp = require("request-promise-native");
module.exports = function(RED) {
    "use strict";
    const bodyParser = require("body-parser");
    const crypto = require('crypto');
    const jsonParser = bodyParser.json();
    //
    //  Cache Management
    //
    function __wwsCache (limit) {
        this.theCache       = [];
        this.limit          = limit;
        this.nummberOfItems = 0;

        //
        //  Dump the Cache
        //
        this.dumpCache = function() {
            console.log('************************************');
            console.log('wwsWebhook.cache.dump : Starting');
            for (let i = 0; i < this.theCache.length; i++) console.log(this.theCache[i].messageId + ' -- ' + this.theCache[i].payload.content);
            console.log('total number of elements = ' + this.nummberOfItems);
            console.log('maximum capacity         = ' + this.limit);
            console.log('************************************');
        }
        //
        //  Add item to Cache
        //
        this.push = function(id, body) {
            if (body) {
                var newElement = {};
                newElement.messageId = id;
                newElement.payload   =  JSON.parse(JSON.stringify(body));
                if (this.nummberOfItems < this.limit) {
                    this.theCache.push(newElement);
                    this.nummberOfItems = this.nummberOfItems + 1;
                    console.log('wwsWebhook.cache.push : new item added for messageId ' + newElement.messageId + '. Total items in cache = ' + this.nummberOfItems);
                } else {
                    //
                    //  Need to remove eldest touched to make space for the new one
                    //
                    let removedItem = this.theCache.shift();
                    this.theCache.push(newElement);
                    console.log('wwsWebhook.cache.push : new item for messageId ' + newElement.messageId + ' replaced item for messageId ' + removedItem.messageId);
                }
            } else {
                //
                //  Message body is NULL, do not do anything
                //
                console.log('wwsWebhook.cache.push : Content for messageId ' + id + ' is Empty. Skipping operation. Total items in cache = ' + this.nummberOfItems);
            }
        }
        //
        //  get Cached item by Id
        //
        this.getById = function(messageId) {
            var found = -1;
            for (let i=0; i < this.theCache.length; i++) {
                if (this.theCache[i].messageId === messageId) {
                    found = i;
                    break;
                }
            }
            if (found >= 0) {
                console.log('wwsWebhook.cache.getById : messageId ' + messageId + ' was found in Cache and returned');
                return this.theCache[found];
            } else {
                console.log('wwsWebhook.cache.getById : messageId ' + messageId + ' was NOT FOUND in Cache. Returning NULL');
                return null;
            }
        }
        //
        //  Removing Element from Cache
        //
        this.removeById = function(messageId) {
            var found = -1;
            for (let i=0; i < this.theCache.length; i++) {
                if (this.theCache[i].messageId === messageId) {
                    found = i;
                    break;
                }
            }
            if (found >= 0) {
                console.log('wwsWebhook.cache.removeById : messageId ' + messageId + ' was found in Cache and removed');
                this.theCache.splice(found, 1);
                this.nummberOfItems = this.nummberOfItems - 1;
            } else {
                console.log('wwsWebhook.cache.removeById : messageId ' + messageId + ' was NOT FOUND in Cache. Returning FALSE');
            }
            return (found >= 0)
        }
    }

    function WWSWebhookNode(config) {
        RED.nodes.createNode(this,config);
        this.active = true;
        this.application = RED.nodes.getNode(config.application);
        this.webhookPath = config.webhookPath;

        //
        //  Cache management
        //
        if (isNaN(config.cacheLimit)) {
            this.theCache = new __wwsCache(5000);
        } else {
            this.theCache = new __wwsCache(config.cacheLimit);
        }
        this.theCache.dumpCache();
        var node = this;
        if (!node.application) {
            node.error("Please configure your Watson Workspace App first!");
            node.status({fill: "red", shape: "dot", text: "token unavailable"});
        } else {
            var appId = node.application.clientId;
        }
        //
        //  Helper to build the graphQL query string
        //
        function __getMessageInformation(messageId) {
            var query = 'query getMessage { message(id: "' + messageId + '") {';
            query += 'id content contentType annotations';
            query += ' created createdBy {id displayName email customerId presence photoUrl}';
            query += ' updated updatedBy {id displayName email customerId presence photoUrl}';
            query += ' reactions {reaction count viewerHasReacted}'
            query += '}}';
            return query;
        }
        //
        //  Helper to perform GraphQL calls
        //
        function __wwsGraphQL(accessToken, host, query, viewType, operationName, variables) {
            var uri = host + "/graphql";
            var options = {
              method: "POST",
              uri: uri,
              headers: {
                "Authorization": "Bearer " + accessToken,
                "x-graphql-view": viewType
              },
              json: true,
              body: {
                query: query
              }
            };
            if (variables) options.body.variables = variables;
            if (operationName) options.body.operationName = operationName;
            return rp(options);
        }
        //
        //  Get Message Details
        //
        function __wwsGetMessage(msg, messageId, type) {
            let host = node.application &&  node.application.getApiUrl() || "https://api.watsonwork.ibm.com";
            let bearerToken = node.application.getAccessToken(node).access_token;
            //
            //  Build the query
            //
            var query = __getMessageInformation(messageId);
            //
            //  Perform the operation
            //
            __wwsGraphQL(bearerToken, host, query,'PUBLIC')
                .then((res) => {
                    if (res.errors) {
                        //
                        //  Strange Errors
                        //
                        msg.payload = res.errors;
                        console.log('wwsWebhook.__wwsGetMessage.__wwsGraphQL : errors getting Message ' + messageId);
                        console.log(JSON.stringify(res.errors));
                        node.status({fill: "red", shape: "dot", text: "errors getting Message " + messageId});
                        node.error("errors getting Message " + messageId, msg);
                        return;
                    } else {
                        //
                        //  Successfull Result !
                        //
                        msg.wwsOriginalMessage = res.data.message;
                        if (msg.wwsOriginalMessage) {
                            console.log('wwsWebhook.__wwsGetMessage : ORIGINAL Message (' + msg.wwsOriginalMessage.id + ') for messageID ' + messageId + ' succesfully retrieved!');
                            //
                            //  Parsing Annotations
                            //
                            if (msg.wwsOriginalMessage.annotations) {
                                if (msg.wwsOriginalMessage.annotations.length > 0) {
                                    let annotations = [];
                                    for (let i = 0; i < msg.wwsOriginalMessage.annotations.length; i++) {
                                        annotations.push(JSON.parse(msg.wwsOriginalMessage.annotations[i]));
                                    }
                                    msg.wwsOriginalMessage.annotations = annotations;
                                }
                            }
                        } else {
                            //
                            //  Strange Error. The retrieved message is empty
                            //  Payload is the original message
                            //
                            msg.payload = JSON.parse(msg.wwsEvent.annotationPayload);
                            console.log('wwsWebhook.__wwsGetMessage.__wwsGraphQL : Retrieving Message for messageID ' + messageId + ' returned an EMPTY MESSAGE - Returning res.data !!!');
                            console.log(JSON.stringify(res.data));
                        }
                        node.status({fill: "green", shape: "dot", text: messageId + ' retrieved!'});
                        node.theCache.push(messageId, res.data.message);
                        __sendFinalMessage(msg, config, type);
                    }})
                .catch((err) => {
                    console.log("wwsWebhook.__wwsGetMessage : errors getting Message " + messageId);
                    console.log(err);
                    node.status({fill: "red", shape: "ring", text: "errors getting Message " + messageId});
                    node.error("wwsWebhook.__wwsGetMessage : errors getting Message " + messageId, err);
                    return;
                });
        }
        //
        //  Send the Message
        //
        function __sendFinalMessage(msg, config, type) {
            console.log('wwsWebhook.__sendFinalMessage for type ' + type);
            //
            //  Check if we are dealing with Annotations originating from Own App
            //
            if (msg.wwsOriginalMessage) {
                if (msg.wwsOriginalMessage.userId === appId) {
                    //
                    //  Own App annotation... Do not deal with it
                    //
                    if (config.noOwnAnnotations) {
                        console.log('wwsWebhook.__sendFinalMessage : dealing with Own AppMessage Annotation');
                        return;
                    } else {
                        console.log('wwsWebhook.__sendFinalMessage : ACCEPTING Own AppMessage Annptation');
                    }
                }
            }
            //
            //  Check if there is ONLY one output for everything or we need to separate outputs
            //
            if (config.filterOutputs) {
                //
                //  Array of answers... only one of which is not NULL corresponding to the req.body.type
                //
                let items = config.hidden_string.split(',');
                let theIndex = -1;
                for (let k = 0; k < items.length; k++) {
                    if (items[k].trim() === type) {
                        theIndex = k;
                        break;
                    }
                }
                //
                //  Build an array of NULL messages
                //
                let outArray = [];
                for (let k = 0; k < items.length; k++) {
                    outArray.push(null);
                }
                //
                //  Now fill the answer in the right position :-)
                //
                outArray[theIndex] = msg;
                //
                //  Provide the answer
                //
                node.status({fill: "green", shape: "dot", text: "action processed " + type});
                node.send(outArray);
            } else {
                //
                //  No Filtering
                //
                node.status({fill: "green", shape: "dot", text: "action processed " + type});
                node.send(msg);
            }
        }
        //
        //  Was the Webhook properly initalized ?
        //
        if (!node.credentials.webhookSecret) {
            node.error("WWSWebhookNode: Missing Webhook Secret!");
        }
        //
        //  Check for token on start up
        //
        //Check for token on start up
        if (!node.application || !node.application.hasAccessToken()) {
            node.error("Please configure your Watson Workspace App first!");
            node.status({fill: "red", shape: "dot", text: "token unavailable"});
        }
        //
        //  Remove webhook when deleted
        //
        this.on("close",function() {
            RED.httpNode._router.stack.forEach(function(route,i,routes) {
                if (route.route && route.route.path === node.webhookPath && route.route.methods["post"]) {
                    routes.splice(i,1);
                }
            });
        });
        //
        //  Convenience for changing Status on NodeRed Console
        //
        node.setStatus = (type) => {
            var statusTimeout;
            return new Promise((resolve) => {
                //
                //  clear any existing timeout first
                //
                if (statusTimeout) {
                    clearTimeout(statusTimeout);
                }
                node.status({fill: "blue", shape: "dot", text: "Event received: " + type});
                resolve();
            }).then(() => {
                statusTimeout = setTimeout(() => {
                    node.status({});
                }, 5000);
            });
        };
        //
        //  Callback for request processing
        //
        node.processRequest = function(req, res, next){
            var msg = {};
            msg.payload = {};
            node.isApp = (memberIds) => {
                var found = false;
                if (memberIds && memberIds.length>0) {
                    found = (appId === memberIds[0]);
                }
                return found;
            };
            //
            //  if req and res
            //
            if(req && res) {
                //
                // if properties in body are valid...
                //
                if((typeof req.body === 'object') && req.body.type) {
                    node.setStatus(req.body.type);
                    if ((req.body.type === 'verification') && req.body.challenge) {
                        //
                        //  App Registration Processing
                        //  An HMAC-SHA256 hash of the JSON response body.
                        //  The hash is generated with the webhookSecret of the webhook as key.
                        //
                        var responseBody = {response: req.body.challenge};
                        const hash = crypto.createHmac('sha256', node.credentials.webhookSecret).update(JSON.stringify(responseBody)).digest('hex');
                        const headers = {
                            "X-OUTBOUND-TOKEN": hash,
                            "Content-Type": "application/json;charset=UTF-8"
                        };
                        res.set(headers).status(200).send(responseBody);
                    } else {
                        //
                        //  Ignoring own app messages
                        //
                        if (req.body.userId !== appId) {
                            console.log('wwsWebhook: PROCESSING incoming <' + req.body.type + '> event type...');
                            function __whichOriginalMessage(msg) {
                                var theId = '';
                                //
                                //  if referralMessageId is present, it takes precedence
                                //
                                if (msg.payload && msg.payload.referralMessageId) {
                                    console.log('wwsWebhook.__whichOriginalMessage: retrieving referral message ' + msg.payload.referralMessageId);
                                    theId =  msg.payload.referralMessageId;
                                } else {
                                    console.log('wwsWebhook.__whichOriginalMessage: retrieving normal message ' + msg.wwsMessageId);
                                    theId = msg.wwsMessageId;
                                }
                                return theId;
                            }
                            function __myJSONparse(str) {
                                try {
                                    let a = JSON.parse(str);
                                    return a;
                                } catch (e) {
                                    return str;
                                }
                            }                            
                            let originalMessage  = null;
                            let msgToBeRetrieved = null;
                            let ignore           = false;
                            //
                            //  Webhook Event Processing
                            //
                            msg.wwsSpaceId   = req.body.spaceId;
                            msg.wwsSpaceName = req.body.spaceName;
                            msg.wwsMessageId = req.body.messageId;
                            msg.wwsType      = req.body.type;
                            //
                            //  ignoring own app message
                            //
                            switch(req.body.type) {
                                case "message-created":
                                    //
                                    //  Message-Created
                                    //  ----------------
                                    //
                                    //  Prepare output information
                                    //
                                    if (!msg.payload) {
                                        //
                                        //  Ignore empty message-created entries (happens during app messages e.g. from other apps attached to the same space)
                                        //
                                        ignore = true;
                                    } else {
                                        msg.wwsUserName = req.body.userName;
                                        msg.wwsUserId   = req.body.userId;
                                        msg.payload     = req.body.content;
                                        //
                                        //  Since this is a message, we can store it in the cache for further re-use
                                        //
                                        node.theCache.push(msg.wwsMessageId, req.body);
                                    }
                                    break;
                                case "message-edited":
                                    //
                                    //  Message-Edited
                                    //  --------------
                                    //
                                    //  Prepare output information
                                    //
                                    msg.wwsUserName = req.body.userName;
                                    msg.wwsUserId   = req.body.userId;
                                    msg.payload     = req.body.content;
                                    //
                                    //  We need to remove the old message from the cache (if it existed) ...
                                    //
                                    node.theCache.removeById(msg.wwsMessageId);
                                    //
                                    //  ....and re-add it ...
                                    //
                                    node.theCache.push(msg.wwsMessageId, req.body);
                                     break;
                                case "message-deleted":
                                    //
                                    //  Message-Deleted
                                    //  ----------------
                                    //
                                    //  Prepare output information
                                    //
                                    msg.payload = msg.wwsMessageId;
                                    //
                                    //  We need to remove the old message from the cache (if it existed) ...
                                    //
                                    node.theCache.removeById(msg.wwsMessageId);
                                    break;
                                case "message-annotation-added":
                                    //
                                    //  Message-Annotation-Added
                                    //  ------------------------
                                    //
                                    //  Prepare output information
                                    //

                                    console.log(JSON.stringify(req.body, ' ', 2));

                                    msg.wwsAnnotationId      = req.body.annotationId;
                                    msg.wwsAnnotationService = req.body.userId;
                                    msg.wwsAnnotationType    = req.body.annotationType;
                                    if (msg.wwsAnnotationType === "actionSelected") {
                                        let annotationPayload = JSON.parse(req.body.annotationPayload);
                                        msg.wwsActionId = annotationPayload.actionId;
                                    }
                                    msg.payload              = JSON.parse(req.body.annotationPayload);
                                    if (msg.payload.payload) msg.payload.payload = __myJSONparse(msg.payload.payload);
                                    if (msg.payload.context) msg.payload.context = __myJSONparse(msg.payload.context);
                                    //
                                    //  The Annotation refers to a Message.
                                    //  Is the message already in Cache ?
                                    //
                                    msg.wwsReferralMsgId = __whichOriginalMessage(msg);
                                    msgToBeRetrieved = __whichOriginalMessage(msg);
                                    originalMessage = node.theCache.getById(msgToBeRetrieved);
                                    if (originalMessage) {
                                        //
                                        //  A message was found. Attach it to the payload
                                        //
                                        msg.wwsOriginalMessage = JSON.parse(JSON.stringify(originalMessage.payload));
                                        msgToBeRetrieved = null;
                                    }
                                    break;
                                case "message-annotation-edited":
                                    //
                                    //  Message-Annotation-Edited
                                    //  -------------------------
                                    //
                                    //  Prepare output information
                                    //
                                    msg.wwsAnnotationId      = req.body.annotationId;
                                    msg.wwsAnnotationService = req.body.userId;
                                    msg.wwsAnnotationType    = req.body.annotationType;
                                    if (msg.wwsAnnotationType === "actionSelected") {
                                        let annotationPayload = JSON.parse(req.body.annotationPayload);
                                        msg.wwsActionId = annotationPayload.actionId;
                                    }
                                    msg.payload = JSON.parse(req.body.annotationPayload);
                                    if (msg.payload.payload) msg.payload.payload = __myJSONparse(msg.payload.payload);
                                    if (msg.payload.context) msg.payload.context = __myJSONparse(msg.payload.context);
                                    //
                                    //  The Annotation refers to a Message.
                                    //  Is the message already in Cache ?
                                    //
                                    msg.wwsReferralMsgId = __whichOriginalMessage(msg);
                                    msgToBeRetrieved = __whichOriginalMessage(msg);
                                    originalMessage = node.theCache.getById(msgToBeRetrieved);
                                    if (originalMessage) {
                                        //
                                        //  A message was found. Attach it to the payload
                                        //
                                        msg.wwsOriginalMessage = JSON.parse(JSON.stringify(originalMessage.payload));
                                        msgToBeRetrieved = null;
                                    }
                                    break;
                                case "message-annotation-removed":
                                    //
                                    //  Message-Annotation-Removed
                                    //  --------------------------
                                    //
                                    //  Prepare output information
                                    //
                                    msg.wwsAnnotationId      = req.body.annotationId;
                                    msg.wwsAnnotationService = req.body.userId;
                                    msg.wwsAnnotationType    = req.body.annotationType;
                                    //
                                    //  The Annotation refers to a Message.
                                    //  Is the message already in Cache ?
                                    //
                                    originalMessage = node.theCache.getById(msg.wwsMessageId);
                                    if (originalMessage) {
                                        //
                                        //  A message was found. Attach it to the payload
                                        //
                                        msg.wwsOriginalMessage = JSON.parse(JSON.stringify(originalMessage.payload));
                                    } else {
                                        //
                                        //  We need to retrieve the original message as it is not in the cache
                                        //
                                        msgToBeRetrieved = true;
                                    }
                                    break;   
                                case "reaction-added":
                                    //
                                    //  Reaction-Added
                                    //  --------------
                                    //
                                    //  Prepare output information
                                    //
                                    msg.wwsUserId       = req.body.userId;
                                    msg.wwsMessageId    = req.body.objectId;
                                    msg.wwsReactionType = req.body.objectType;
                                    msg.payload         = req.body.reaction;
                                    //
                                    //  The Reaction refers to a Message.
                                    //  Is the message already in Cache ?
                                    //
                                    msg.wwsReferralMsgId = __whichOriginalMessage(msg);
                                    msgToBeRetrieved = __whichOriginalMessage(msg);
                                    originalMessage = node.theCache.getById(msgToBeRetrieved);
                                    if (originalMessage) {
                                        //
                                        //  A message was found. Attach it to the payload
                                        //
                                        msg.wwsOriginalMessage = JSON.parse(JSON.stringify(originalMessage.payload));
                                        msgToBeRetrieved = null;
                                    }
                                    break;
                                case "reaction-removed":
                                    //
                                    //  Reaction-Removed
                                    //  ----------------
                                    //
                                    //  Prepare output information
                                    //
                                    msg.wwsUserId       = req.body.userId;
                                    msg.wwsMessageId    = req.body.objectId;
                                    msg.wwsReactionType = req.body.objectType;
                                    msg.payload         = req.body.reaction;
                                    //
                                    //  The Reaction refers to a Message.
                                    //  Is the message already in Cache ?
                                    //
                                    msg.wwsReferralMsgId = __whichOriginalMessage(msg);
                                    msgToBeRetrieved = __whichOriginalMessage(msg);
                                    originalMessage = node.theCache.getById(msgToBeRetrieved);
                                    if (originalMessage) {
                                        //
                                        //  A message was found. Attach it to the payload
                                        //
                                        msg.wwsOriginalMessage = JSON.parse(JSON.stringify(originalMessage.payload));
                                        msgToBeRetrieved = null;
                                    }
                                    break;
                                case "space-updated":
                                    //
                                    //  Space-Updated
                                    //  --------------
                                    //
                                    //  Prepare output information
                                    //
                                    msg.wwsUserId = req.body.userId;
                                    if (req.body.spaceProperties) {
                                        msg.payload = req.body.spaceProperties;
                                        msg.wwsUpdateCause = "property-change";
                                    } else {
                                        if (req.body.description) {
                                            msg.payload = req.body.description;
                                            msg.wwsUpdateCause = "description-change";
                                        } else {
                                            if (req.body.title) {
                                                msg.wwsUpdateCause="title-change";
                                                msg.payload = req.body.title;
                                            } else {
                                                if (req.body.statusValue) {
                                                    msg.wwsUpdateCause = "status-change";
                                                    msg.payload = req.body.statusValue;
                                                } else {
                                                    msg.wwsUpdateCause="other";
                                                }
                                            }
                                        }
                                    }
                                    break;
                                case "space-deleted":
                                    //
                                    //  Space-Deleted
                                    //  -------------
                                    //
                                    //  Prepare output information
                                    //
                                    msg.wwsUserId = req.body.userId;
                                    break;
                                case "space-members-added":
                                    //
                                    //  Space-Members-Added
                                    //  -------------------
                                    //
                                    //  Prepare output information
                                    //
                                    if (node.isApp(req.body.memberIds)) {
                                        msg.wwsCause = "app-added";
                                    }
                                    msg.payload = req.body.memberIds;
                                    break;   
                                case "space-members-removed":
                                    //
                                    //  Space-Members-Removed
                                    //  ---------------------
                                    //
                                    //  Prepare output information
                                    //
                                    if (node.isApp(req.body.memberIds)) {
                                        msg.wwsCause = "app-removed";
                                    }
                                    msg.payload = req.body.memberIds;
                                    break;   
                                case "appMessage":
                                    //
                                    //  appMessage
                                    //  -------------------
                                    //
                                    //  do NOT process app messages
                                    //
                                    ignore = true;
                                    break;
                            }
                            //
                            //  Send response to Webhook to avoid timeouts!
                            //
                            res.sendStatus(200);
                            if (!ignore) {
                                //
                                //  Store original request body
                                //
                                msg.wwsEvent = req.body;
                                //
                                //  Check if the original message needs to be retrieved
                                //
                                if (msgToBeRetrieved) {
                                    console.log('wwsWebhook : retrieving original message ' + msgToBeRetrieved);
                                    __wwsGetMessage(msg, msgToBeRetrieved, req.body.type);
                                } else {
                                    __sendFinalMessage(msg, config, req.body.type);
                                }
                            }
                        } else {
                            //
                            //  Own App Message
                            //
                            console.log('wwsWebhook: dealing with Own AppMessage');
                            //
                            //  Send response to Webhook to avoid timeouts!
                            //
                            res.sendStatus(200);
                        }
                    }
                }
            }
        };
        //
        //  Callback for error handling
        //
        node.processError = function(err, req, res, next) {
            node.error(err);
            res.sendStatus(500);
        };
        //
        // create route for this node
        //
        if (RED.settings.httpNodeRoot !== false) {
            var webhookPath = node.webhookPath;
            //
            //  Check if path starts with '/'
            //
            if (webhookPath[0] !== '/') {
                webhookPath = '/' + webhookPath;
            }
            RED.httpNode.post(webhookPath, jsonParser, node.processRequest, node.processError);
            node.log("wws-webhook: Created new route for: " + webhookPath);
        } else {
            node.error("wws-webhook: Could not create a route for " + node.webhookPath);
        }
    }

    RED.nodes.registerType("wws-webhook", WWSWebhookNode,{
        credentials: {
            webhookSecret: {type:"text"}
        }
    });
};
