
var rp = require("request-promise-native");
module.exports = function(RED) {
    "use strict";
     const crypto = require('crypto');
     const bodyParser = require("body-parser");
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
        };
        //
        //  Add item to Cache
        //
        this.push = function(id, body) {
            if (body) {
                let newElement = {};
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
        };
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
        };
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
            return (found >= 0);
        };
    }

    function WWSWebhookNode(config) {    
        //
        //  Helper to perform GraphQL calls
        //
        function _graphQL_options(runtimeToken, graphQL_url, query, viewType, variables, operationName) {
            var options = {
                method: "POST",
                uri: graphQL_url,
                headers: {
                    "x-graphql-view": viewType
                },
                json: true,
                body: {
                    query: query
                }
            };
            //
            //  Fallback to support external provided tokens
            //
            if (runtimeToken) {
                options.headers.Authorization = "Bearer" + runtimeToken;
            }
            if (variables) options.body.variables = variables;
            if (operationName) options.body.operationName = operationName;

            console.log("wwsWebhook._graphQL_options : executing graphQL call with these options");
            console.log(JSON.stringify(options, ' ', 2));
            console.log('-------------------------------------------------------');
            return options;
        }
        function _personQL_details() {
            return '{id displayName email customerId presence photoUrl extId ibmUniqueID created updated}';
        }
        function _templateQL_details() {
            var template = '{';
            template += 'id name description labelIds';
            template += ' spaceStatus {acceptableValues {id displayName} defaultValue}';
            template += ' requiredApps{items {id}}';
            template += ' properties {items {id type displayName ';
            template += '... on SpaceListProperty {defaultValue acceptableValues {id displayName }} ... on SpaceTextProperty {defaultValue} ... on SpaceBooleanProperty {defaultStringValue}}}';
            template += ' created createdBy ' + _personQL_details();
            template += ' updated updatedBy ' + _personQL_details();
            template += '}';
            return template;
        }
        function _messageQL_details() {
            var message = '{';
            message += 'id content contentType annotations';
            message += ' created createdBy ' + _personQL_details();
            message += ' updated updatedBy ' + _personQL_details();
            message += ' reactions {reaction count viewerHasReacted}';
            message += '}';
            return message;
        }
        function _spaceQL_details() {
            var space = '{';
            space += 'id title description visibility';
            //
            //  Template Infos for the space 
            //
            space += ' templateInfo ' + _templateQL_details(); 
            space += ' members {pageInfo {startCursor endCursor hasNextPage hasPreviousPage} items ' + _personQL_details()+ '}';
            space += ' team {id displayName teamSettings {appApprovalEnabled}}';
            space += ' propertyValueIds {propertyId propertyValueId}';
            space += ' statusValueId ';
            space += ' created createdBy ' + _personQL_details();
            space += ' updated updatedBy ' + _personQL_details();
            space += ' conversation {id messages(first: 1) {items ' + _messageQL_details() + '}}';
            //space += ' activeMeeting { meetingNumber password}';
            space += '}';
            return space;
        }
        //
        //  Helper to Get Message Details
        //
        function __wwsGetMessage(msg, messageId, type) {
            //
            //  Helper to build the graphQL query string
            //
            function __getMessageInformation(messageId) {
                var query = 'query getMessage {message(id: "' + messageId + '") ';
                query += _messageQL_details();
                query += '}';
                return query;
            }
            //
            //  Build the query
            //
            var query = __getMessageInformation(messageId);
            //
            //  Perform the operation
            //
            var req = _graphQL_options(null, graphQL_url, query, 'PUBLIC');
            //
            //  Perform the operation
            //
            node.status({fill:"blue", shape:"dot", text:"Getting message..."});
            node.application.wwsRequest(req)
            .then((res) => {
                if (res.errors) {
                    //
                    //  Strange Errors
                    //
                    msg.wwsQLErrors = res.errors;
                    console.log('wwsWebhook.__wwsGetMessage.__wwsGraphQL : Some errors getting Message ' + messageId);
                    console.log(JSON.stringify(res.errors));
                    node.status({fill: "yellow", shape: "dot", text: "Some errors getting Message " + messageId});
                } else {
                    //
                    //  Successfull Result !
                    //
                    node.status({fill: "green", shape: "dot", text: messageId + ' retrieved!'});
                }
                if (res.data && res.data.message) {
                    msg.wwsOriginalMessage = res.data.message;
                } else {
                    msg.wwsOriginalMessage = null;
                }
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
                    console.log('wwsWebhook.__wwsGetMessage.__wwsGraphQL : Retrieving Message for messageID ' + messageId + ' returned an EMPTY MESSAGE - Returning res.data !!!');
                    console.log(JSON.stringify(res.data));
                    node.status({fill: "yellow", shape: "dot", text: "wwsWebhook.__wwsGetMessage.__wwsGraphQL : wwsOriginalMessage is EMPTY"});
                    msg.payload = JSON.parse(msg.wwsEvent.annotationPayload);
               }
                node.theCache.push(messageId, res.data.message);
                __sendFinalMessage(msg, config, type);
            })
            .catch((err) => {
                console.log("wwsWebhook.__wwsGetMessage : errors getting Message " + messageId);
                console.log(err);
                node.status({fill: "red", shape: "ring", text: "errors getting Message " + messageId});
                node.error("wwsWebhook.__wwsGetMessage : errors getting Message " + messageId, err);
                return;
            });
        }
        //
        //  Helper to get the TEMPLATE Info
        //
        function __wwsGetSpace(msg, spaceId, msgToBeRetrieved, config, type) {
            //
            //  Since there is something to do, we need to translate property names, property values (for lists) and statusValues from readable strings to IDs
            //  In order to do this, we first need to get information about the template from which this space has been created
            //
            function _getTemplatedSpaceQuery(spaceId) {
                var query = 'query getTemplatedSpace { space(id: "' + spaceId + '") ';
                query += _spaceQL_details();
                query += '}';
                return query;
            }                        //
            //  Prepare the operation
            //
            var query = _getTemplatedSpaceQuery(spaceId);
            var req = _graphQL_options(msg.wwsToken, graphQL_url, query, "PUBLIC,BETA,EXPERIMENTAL");
            //
            //  Perform the operation
            //
            node.status({fill:"blue", shape:"dot", text:"webhook.wwsGetSpace: Getting Space first..."});
            node.application.wwsRequest(req)
            .then((res) => {
                if (res.errors) {
                    //
                    //  Query Successfull but with Errors
                    //
                    msg.wwsQLErrors = res.errors;
                    console.log('webhook.wwsGetSpace: Some errors getting the Space');
                    console.log(JSON.stringify(res.errors));
                    node.status({fill: "yellow", shape: "dot", text: "Some Errors getting the Space"});
                } else {
                    //
                    //  Ok, we should have the information about the teamplate.
                    //  We need to parse them
                    //
                    console.log('webhook.wwsGetSpace: Space successfully retrieved');
                    node.status({fill: "green", shape: "dot", text: "Space succesfully retrieved"});
                }
                if (res.data.space && res.data.space.templateInfo) {
                    let templateInfo = res.data.space.templateInfo;
                    //
                    //  Did the Status change?
                    //
                    if ((msg.payload) && (msg.payload.statusValueId)) {
                        //
                        //  there was a change in the value of the STATUS. We need to get the DisplayName for it
                        //
                        if (templateInfo.spaceStatus) {
                            let statuses = templateInfo.spaceStatus.acceptableValues;
                            let found = false;
                            for (let i=0; i < statuses.length; i++) {
                                if (msg.payload.statusValueId === statuses[i].id) {
                                    found = true;
                                    msg.payload.statusValueName = statuses[i].displayName;
                                    break;
                                }
                            }
                            if (!found) {
                                //
                                //  We cannot Set a status that does not exist
                                //
                                console.log('webhook.wwsGetSpace: Status ' + msg.payload.statusValue + ' is unknown!');
                                node.status({fill: "red", shape: "dot", text: 'Status ' + msg.payload.statusValue + ' is unknown!'});
                                node.error('webhook.wwsGetSpace: Status ' + msg.payload.statusValue + ' is unknown!', msg);
                                return;
                            }
                        } else {
                            //
                            //  Cannot retrieve the Status DISPLAY NAME
                            //
                            console.log('webhook.wwsGetSpace: cannot provide a name to the STATUS...');
                            node.status({fill: "yellow", shape: "dot", text: 'cannot provide a name to the STATUS...'});
                        }
                    }
                    //
                    //  Did Properties change ?
                    //
                    if ((msg.payload) && (msg.payload.propertyValueIds)) {
                        //
                        //  there was a change in the value of one or more Properties. We need to get the DisplayName and Value for each of thme
                        //
                        console.dir(templateInfo);
                        if (templateInfo.properties && templateInfo.properties.items && Array.isArray(templateInfo.properties.items)) {
                            msg.payload.propertyValueIds = _propertiesIdsToNames(msg.payload.propertyValueIds, templateInfo.properties.items);
                        } else {
                            //
                            //  Cannot retrieve the PROPERTIES DISPLAY NAME
                            //
                            console.log('webhook.wwsGetSpace: cannot provide a name to the PROPERTIES...');
                            node.status({fill: "yellow", shape: "dot", text: 'cannot provide a name to the PROPERTIES...'});
                        }
                    }
                } else {
                    //
                    //  Problems getting the TEMPLATE INFO from the space
                    //
                    console.log('webhook.wwsGetSpace: cannot retrieve information about the TEMPLATE!');
                    node.status({fill: "yellow", shape: "dot", text: 'cannot retrieve information about the TEMPLATE!'});
                }
                //
                //  At this point we can return
                //
                __returnAnswer(msg, msgToBeRetrieved, config, type);
            }).catch((err) => {
                console.log("webhook.wwsGetSpace: Error while getting templatedSpace.", err);
                node.status({fill: "red", shape: "ring", text: "Error while getting templatedSpace..."});
                node.error("webhook.wwsGetSpace: Error while getting templatedSpace.", err);
                return;
            });
        }
        //
        //  Helper for sending the final message (possibly an array of) 
        //
        function __sendFinalMessage(msg, config, type) {
            console.log('wwsWebhook.__sendFinalMessage for type ' + type);
            //
            //  Check if we are dealing with Annotations originating from Own App
            //
            if (msg.wwsOriginalMessage) {
                if (msg.wwsOriginalMessage.userId === whoAmI) {
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
        //  Helper for returning an Answer
        //
        function __returnAnswer(msg, msgToBeRetrieved, config, type) {
            //
            //  Check if the original message needs to be retrieved
            //
            if (msgToBeRetrieved) {
                console.log('wwsWebhook : retrieving original message ' + msgToBeRetrieved);
                __wwsGetMessage(msg, msgToBeRetrieved, type);
            } else {
                __sendFinalMessage(msg, config, type);
            }
        }
        //
        //  Translate PropertyIds to real names
        //
        function _propertiesIdsToNames(properties, templates) {
            var outProperties = [];
            for (let key in properties) {
                 let theProp = {};
                theProp.key = key;
                theProp.value = properties[key];
                console.dir(theProp);

                let found = false;
                let newProp = {};
                for (let j = 0; j < templates.length; j++) {
                    if (theProp.key === templates[j].id) {
                        found = true;
                        newProp.id = templates[j].id;
                        newProp.type = templates[j].type;
                        newProp.displayName = templates[j].displayName;
                        if (templates[j].type === "LIST") {
                            //
                            //  For LISTSs, the value becomes an ID also
                            //
                            found = false;
                            for (let k = 0; k < templates[j].acceptableValues.length; k++) {
                                if (theProp.value === (templates[j].acceptableValues[k].id)) {
                                    found = true;
                                    newProp.valueId = templates[j].acceptableValues[k].id;
                                    newProp.valueDisplayName = templates[j].acceptableValues[k].displayName;
                                    break;
                                }
                            }
                        } else {
                            if (templates[j].type === "BOOLEAN") {
                                //
                                //  Booleans can only be TRUE or FALSe, right ?
                                //
                                if ((theProp.value.toLowerCase() === "true") || (theProp.value.toLowerCase() === "false")) {
                                    newProp.valueId = theProp.value.toUpperCase();
                                    newProp.valueDisplayName = newProp.valueId;
                                } else {
                                    found = false;
                                }
                            } else {
                                //
                                //  Text Attributes. NOTHING to Change
                                //
                                newProp.valueId = theProp.value;
                                newProp.valueDisplayName = newProp.valueId;
                            }
                        }
                        //
                        //  We have found... So we can exit the inner loop
                        //
                        break;
                    }
                }
                //
                //  We have done the parsing
                //
                if (!found) {
                    //
                    //  There was something wrong. Either the name of the property is unknown or the property value is not valid
                    //  returning the index of the offending property
                    //
                    console.dir('webhook._propertiesIdsToNames : Match NOT Found ' + theProp.key);
                } else {
                    outProperties.push(newProp);
                }
            }
            return outProperties;
        }
        function __makePropertiesAndStatusReadable(theSpace, target, node) {
            if (theSpace && theSpace.propertyValueIds) {
              if (theSpace.templateInfo.properties) {
                let tmp = _propertiesIdsToNames(theSpace.propertyValueIds, theSpace.templateInfo.properties.items);
                if (tmp.length > 0) {
                    target.propertyValueNames = tmp;
                } else {
                    console.log('wwsGetTemplatedSpace : ISSUES with properties for space ' + theSpace.title + ' !!!');
                }
              } else {
                console.log('wwsGetTemplatedSpace : No Properties Information in TEMPLATE for space ' + theSpace.title + ' !!!');
                node.warn('wwsGetTemplatedSpace: No Properties Information in TEMPLATE for space ' + theSpace.title);
              }
            } else {
              console.log('wwsGetTemplatedSpace : No properties for space ' + theSpace.title + ' !!!');
            }
            //
            //  And now we need to add the name of the status
            //
            if (theSpace && theSpace.statusValueId) {
              if (theSpace.templateInfo && theSpace.templateInfo.spaceStatus) {
                let statuses = theSpace.templateInfo.spaceStatus.acceptableValues;
                let found = false;
                for (let i = 0; i < statuses.length; i++) {
                  if (theSpace.statusValueId === statuses[i].id) {
                    found = true;
                    target.statusValueName = statuses[i].displayName;
                    break;
                  }
                }
                if (!found) {
                  //
                  //  We cannot get the name of a status that does not exist
                  //
                  console.log('wwsGetTemplatedSpace: Status ' + theSpace.statusValueId + ' for space ' + theSpace.title + ' is unknown!');
                  node.status({fill: "red", shape: "dot", text: 'Status ' + theSpace.statusValueId + ' is unknown!'});
                  node.error('wwsGetTemplatedSpace: Status ' + theSpace.statusValueId + ' for space ' + theSpace.title + ' is unknown!', msg);
                  return false;
                }
              } else {
                console.log('wwsGetTemplatedSpace : No Status Information in TEMPLATE for space ' + theSpace.title + ' !!!');
                node.warn('wwsGetTemplatedSpace: No Status Information in TEMPLATE for space ' + theSpace.title);
              }
            } else {
              console.log('wwsGetTemplatedSpace : No Status Information for space ' + theSpace.title + ' !!!');
            }
            return true;
          }
            
        //
        //  Start Processing
        //
        RED.nodes.createNode(this,config);
        //
        //  Get the application config node
        //
        this.application = RED.nodes.getNode(config.application);
        var node = this;
        //
        //  Check for token on start up
        //
        if (!node.application) {
            node.status({fill: "red", shape: "dot", text: "token unavailable"});
            node.error("wwsWebhookNode: Please configure your Watson Workspace App first!");
            return;
        }
        //
        //  Was the Webhook properly initalized ?
        //
        if (!node.credentials.webhookSecret) {
            node.status({fill: "red", shape: "dot", text: "Webhook secret unavailable"});
            node.error("WWSWebhookNode: Missing Webhook Secret!");
            return;
        }
        var graphQL_url  = node.application.getApiUrl() + "/graphql";
        this.webhookPath = config.webhookPath;
        var whoAmI       = node.application.clientId; 
        //
        //  Cache management
        //
        if (isNaN(config.cacheLimit) || (config.cacheLimit === '')) {
            this.theCache = new __wwsCache(5000);
        } else {
            this.theCache = new __wwsCache(config.cacheLimit);
        }
        this.theCache.dumpCache();

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
                    found = (whoAmI === memberIds[0]);
                }
                return found;
            };
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
            //
            //  if req and res
            //
            if (req && res) {
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
                        //  Verify that the incoming message really comes from Workspace
                        //
                        let theSample = '';
                        if (req.body.type === "message-created") {
                            let tmp = JSON.parse(JSON.stringify(req.body));
                            tmp.content =  encodeURIComponent(tmp.content);
                            theSample = JSON.stringify(tmp);
                        } else {
                            theSample = JSON.stringify(req.body);
                        }
                        //
                        //  Ignoring own app messages
                        //
                        if (req.body.userId !== whoAmI) {
                            console.log('wwsWebhook: PROCESSING incoming <' + req.body.type + '> event type...');
                            if (req.body && req.headers 
//                            && (req.headers['x-outbound-token'] === crypto.createHmac('sha256', node.credentials.webhookSecret).update(theSample).digest('hex'))
                            ) {
                                //
                                //  GENUINE MESSAGE
                                //
                                let originalMessage  = null;
                                let msgToBeRetrieved = null;
                                let ignore           = false;  // to skip self-generated messages and annotations
                                let getSpace         = false;  // to get Space information when required
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
                                        msgToBeRetrieved = __whichOriginalMessage(msg);
                                        originalMessage = node.theCache.getById(msgToBeRetrieved);
                                        msg.wwsReferralMsgId = msgToBeRetrieved;
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
                                        msgToBeRetrieved = __whichOriginalMessage(msg);
                                        originalMessage = node.theCache.getById(msgToBeRetrieved);
                                        msg.wwsReferralMsgId = msgToBeRetrieved;
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
                                        msgToBeRetrieved = __whichOriginalMessage(msg);
                                        originalMessage = node.theCache.getById(msgToBeRetrieved);
                                        msg.wwsReferralMsgId = msgToBeRetrieved;
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
                                        msgToBeRetrieved = __whichOriginalMessage(msg);
                                        originalMessage = node.theCache.getById(msgToBeRetrieved);
                                        msg.wwsReferralMsgId = msgToBeRetrieved;
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
                                        //  In case of "property-change" and/or "status-change", it will be helpful to inform the user about the 
                                        //  real names of the properties, of their values and of the status.
                                        //  In this case we need to get the information about the SPACE in which the modification happened in order to
                                        //  get the actual displayName of the properties, property values and status values.
                                        //
                                        //  Prepare output information
                                        //
                                        let infoCollected = false;
                                        msg.wwsUserId = req.body.userId;
                                        if (req.body.spaceProperties) {
                                            console.log('wwsWebhook : space-updated ... Properties Change ');
                                            if (! msg.payload) msg.payload = {};
                                            msg.payload.propertyValueIds = req.body.spaceProperties;
                                            msg.wwsUpdateCause = "property-change";
                                            getSpace = true;
                                            infoCollected = true;
                                        }
                                        if (req.body.statusValue) {
                                            console.log('wwsWebhook : space-updated ... Status Change ');
                                            if (! msg.payload) msg.payload = {};
                                            msg.payload.statusValueId = req.body.statusValue;
                                            if (infoCollected) {
                                                msg.wwsUpdateCause += ', status-change';
                                            } else {
                                                msg.wwsUpdateCause = "status-change";
                                            }
                                            getSpace = true;
                                            infoCollected = true;
                                        }
                                        if (req.body.description) {
                                            console.log('wwsWebhook : space-updated ... Description Change ');
                                            if (! msg.payload) msg.payload = {};
                                            msg.payload.description = req.body.description;
                                            if (infoCollected) {
                                                msg.wwsUpdateCause += ', description-change';
                                            } else {
                                                msg.wwsUpdateCause = "description-change";
                                            }
                                            infoCollected = true;
                                        } 
                                        if (req.body.title) {
                                            console.log('wwsWebhook : space-updated ... Title Change ');
                                            if (! msg.payload) msg.payload = {};
                                            msg.payload.title = req.body.title;
                                            if (infoCollected) {
                                                msg.wwsUpdateCause += ', title-change';
                                            } else {
                                                msg.wwsUpdateCause = "title-change";
                                            }
                                            infoCollected = true;
                                        } 
                                        if (! infoCollected) {
                                            console.log('wwsWebhook : space-updated ... OTHER GENERIC Change ');
                                            msg.wwsUpdateCause="other";
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
                                        console.log('wwsWebhook : appMessage received... IGNORING ');
                                        ignore = true;
                                        break;
                                    default:
                                        console.dir(' ');
                                        console.dir('********************************************');
                                        console.dir(' ');
                                        console.dir('webhook: UNKNOWN INCOMING EVENT');
                                        console.dir(JSON.stringify(req.body, ' ', 2));
                                        console.dir(' ');
                                        console.dir('********************************************');
                                        console.dir(' ');
                                        node.status({fill: "red", shape: "ring", text: "UNKNOWN EVENT"});
                                        node.error("wwsWebhook : An unknown event arrived into the Webhook ");
                                        //
                                        //  do NOT process this message
                                        //
                                        ignore = true;
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
                                    if (getSpace) {
                                        //
                                        //  We need to retrieve the Space infos before returning
                                        //  We delegate the return to the space function
                                        //
                                        __wwsGetSpace(msg, msg.wwsSpaceId, msgToBeRetrieved, config, req.body.type) 
                                    } else {
                                        //
                                        //  We can return without getting Space infos
                                        //
                                        __returnAnswer(msg, msgToBeRetrieved, config, req.body.type);
                                    }
                                }
                            } else {
                                //
                                //  The message comes from a compromised source
                                //
                                console.dir(' ');
                                console.dir('********************************************');
                                console.dir(' ');
                                console.dir('webhook: COMPROMISED MESSAGE !!!!!!!!');
                                console.dir('This message does not come from IBM WATSON WORKSPACE ');
                                console.dir('The incoming X-OUTBOUND-TOKEN is : ' + req.headers['x-outbound-token']);
                                console.dir('The incoming request is :');
                                console.dir(JSON.stringify(req.body));
                                console.dir(req.body);
                                console.dir(' ');
                                console.dir('We would have expected a different HASH : ' + crypto.createHmac('sha256', node.credentials.webhookSecret).update(req.body).digest('hex'));
                                console.dir('********************************************');
                                console.dir(' ');
                                node.status({fill: "red", shape: "ring", text: "COMPROMISED MESSAGE"});
                                node.error("wwsWebhook : COMPROMISED MESSAGE !! Check LOG FILE ");
                                //
                                //  We respond 200 because, otherwise, we block the reception of new messages
                                //
                                res.sendStatus(200);
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
            let webhookPath = node.webhookPath;
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
