
module.exports = function(RED) {
    "use strict";
    const bodyParser = require("body-parser");
    const OAuth2 = require('simple-oauth2');
    const StateMachine = require('javascript-state-machine');
    const crypto = require('crypto');
    const jsonParser = bodyParser.json();



    function WWSWebhookNode(config) {
        RED.nodes.createNode(this,config);
        this.active = true;
        this.account = config.account;
        this.accountConfig = RED.nodes.getNode(this.account);
        this.accountConfigCredentials = RED.nodes.getCredentials(this.account);
        this.webhookPath = config.webhookPath;
        const appId = this.accountConfigCredentials.clientId
        var node = this;
        if (!node.credentials.webhookSecret) {
            this.error("Missing Webhook Secret!");
        }

        this.on("close",function() {
            //Remove webhook when deleted
            RED.httpNode._router.stack.forEach(function(route,i,routes) {
                if (route.route && route.route.path === node.webhookPath && route.route.methods["post"]) {
                    routes.splice(i,1);
                }
            });
        });
        node.setStatus = (type) => {
            var statusTimeout;

            return new Promise((resolve) => {
                //clear any existing timeout first
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
        }
        //Callback for request processing
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
            // if req and res
            if(req && res) {

                // if properties in body are valid...
                if(typeof req.body === 'object' && req.body.type) {
                    node.setStatus(req.body.type);
                    //Store request body for reference and further usage.
                    if (req.body.type === 'verification' && req.body.challenge) {
                        //App Registration Processing
                        //An HMAC-SHA256 hash of the JSON response body.
                        //The hash is generated with the webhookSecret of the webhook as key.
                        var responseBody = {response: req.body.challenge};
                        const hash = crypto.createHmac('sha256', node.credentials.webhookSecret)
                        .update(JSON.stringify(responseBody))
                        .digest('hex');
                        //Set required headers
                        const headers = {
                            "X-OUTBOUND-TOKEN": hash,
                            "Content-Type": "application/json;charset=UTF-8"
                        };
                        res.set(headers).status(200).send(responseBody);

                    } else {
                        //Webhook Event Processing
                        msg.spaceId = req.body.spaceId;
                        msg.spaceName = req.body.spaceName;
                        msg.messageId = req.body.messageId;
                        msg.type = req.body.type;
                        //ignoring own app message
                        var ignore = req.body.userId===appId;
                        switch(req.body.type) {
                            case "message-created":
                                //do sth;
                                msg.userName = req.body.userName;
                                msg.userId = req.body.userId;
                                msg.payload = req.body.content;
                                if (!msg.payload) {
                                    //Ignore empty message-created entries (happens during app messages e.g. from other apps attached to the same space)
                                    ignore = true;
                                }
                                break;
                            case "message-deleted":
                                //do sth;
                                msg.payload = msg.messageId;
                                break;
                            case "message-annotation-added":
                                //do sth;
                                msg.annotationId = req.body.annotationId;
                                msg.annotationService = req.body.userId;
                                msg.annotationType = req.body.annotationType;
                                msg.payload = JSON.parse(req.body.annotationPayload);
                                break;
                            case "message-annotation-edited":
                                //do sth;
                                msg.annotationId = req.body.annotationId;
                                msg.annotationService = req.body.userId;
                                msg.annotationType = req.body.annotationType;
                                msg.payload = JSON.parse(req.body.annotationPayload);
                                break;
                            case "message-annotation-removed":
                                //do sth;
                                msg.reactor = req.body.userId;
                                msg.relatedMessage = req.body.objectId;
                                msg.reactionType = req.body.objectType;
                                msg.payload = req.body.reaction;
                                break;   
                            case "reaction-added":
                                //do sth;
                                msg.reactor = req.body.userId;
                                msg.relatedMessage = req.body.objectId;
                                msg.reactionType = req.body.objectType;
                                msg.payload = req.body.reaction;
                                break;
                            case "reaction-removed":
                                //do sth;
                                msg.reactor = req.body.userId;
                                msg.relatedMessage = req.body.objectId;
                                msg.reactionType = req.body.objectType;
                                msg.payload = req.body.reaction;
                                break;
                            case "space-updated":
                                //do sth;
                                msg.updater = req.body.userId;
                                msg.spaceProperties = req.body.spaceProperties;
                                if (req.body.title) {
                                    //Space Title has been updated
                                    msg.updateCause="title-change";
                                    msg.spaceName = req.body.title;
                                    msg.payload = req.body.title;
                                } else {
                                    msg.updateCause="other";
                                }
                                break;
                            case "space-deleted":
                                //do sth;
                                msg.payload = req.body.userId;
                                break;
                            case "space-members-added":
                                //do sth;
                                if (node.isApp(req.body.memberIds)) {
                                    msg.cause = "app-added";
                                }
                                msg.payload = req.body.memberIds;
                                break;   
                            case "space-members-removed":
                                //do sth;
                                if (node.isApp(req.body.memberIds)) {
                                    msg.cause = "app-removed";
                                }
                                msg.payload = req.body.memberIds;
                                break;   
                            case "appMessage":
                                //do NOT process app messages
                            	   ignore = true;
                                break;

                        }
	                    	//Send response to Webhook to avoid timeouts!
	                    	res.sendStatus(200);
                        if (!ignore) {
	                        	//Store original request body
	                        	msg.event = req.body;
	                        	node.send(msg);
                        }
                    }
                }
            }

        };

        //Callback for error handling
        node.processError = function(err, req, res, next) {
            node.error(err);
            res.sendStatus(500);
          };

        // create route for this node
        if (RED.settings.httpNodeRoot !== false) {
            var webhookPath = node.webhookPath;
            //Check if path starts with '/'
            if (webhookPath[0] !== '/') {
                webhookPath = '/'+webhookPath;
            }
            RED.httpNode.post(webhookPath, jsonParser, node.processRequest, node.processError);
            node.log("Created new route for: " + webhookPath);
        } else {
            node.error("Could not create a rout for " + webhookPath);
        }
    }

    RED.nodes.registerType("webhook",WWSWebhookNode,{
        credentials: {
            webhookSecret: {type:"text"}
        }
    });
}
