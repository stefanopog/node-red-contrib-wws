
module.exports = function(RED) {
    "use strict";

    function WWSAppMessageNode(config) {
        RED.nodes.createNode(this,config);
        //
        //  Service routines
        //
        function _prepareAppMessage(config, msg, thePayload) {
            //
            //  Check for defaults
            //
            let annotation = {
                "type": "generic",
                "version": 1.0
            };
            if (msg.wwsAvatar ||config.avatar) {
                annotation.actor = {"name": config.avatar ? config.avatar : msg.wwsAvatar};
            }
            if (msg.wwsColor || config.color) {
                annotation.color = config.color ? config.color : msg.wwsColor;
            } else {
                annotation.color = "#11ABA5";
            }
            if (msg.wwsTitle || config.color) {
                annotation.title = config.title ? config.title : msg.wwsTitle;
            }
            annotation.text = thePayload;
            let reqBody = {
                "type": "appMessage",
                "version": 1.0,
                "annotations":  [annotation]
            };
            msg.reqBody = reqBody;
            return msg;
        }
    

        //
        //  start decoration checking
        //
        //let stringOrDefault = (value, defaultValue) => {
        //    return typeof value == 'string' && value.length > 0 ? value : defaultValue;
        //};
        //this.color = stringOrDefault(config.color, "#11ABA5");
        //this.avatar = stringOrDefault(config.avatar, undefined);
        //this.spaceId = stringOrDefault(config.spaceId, undefined);
        //this.picture = stringOrDefault(config.picture, undefined);
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
            node.error("wws-message-post: Please configure your Watson Workspace App first!");
            return;
        }
        //
        //  Start processing
        //
        this.on('input', function(msg) {
            //
            //  check if there is something to send
            //
            if (!msg.payload && ((!config.payload) || (config.payload.trim() === ''))) {
                node.status({fill:"red", shape:"dot", text:"No Payload"});
                node.error("wws-message-post: Missing required input in msg object: payload");
                return;
            }
            let thePayload = '';
            if ((config.payload) && (config.payload.trim() !== '')) {
                thePayload = config.payload.trim();
            } else {
                if (msg.payload.trim() !== '') {
                    thePayload = msg.payload.trim();
                } else {
                    node.status({fill:"red", shape:"dot", text:"No Payload"});
                    node.error("wws-message-post: Missing required input in msg object: payload");
                    return;
                }
            }
            //
            //  check if there is a destination for the msg to be sent
            //
            if (!msg.wwsSpaceId && (config.spaceId.trim() === '')) {
                node.status({fill:"red", shape:"dot", text:"No Space Id"});
                node.error("wws-message-post: Missing required input in msg object: wwsSpaceId");
                return;
            }
            let spaceId = '';
            if (config.spaceId.trim() !== '') {
                spaceId = config.spaceId.trim();
            } else {
                if (msg.wwsSpaceId.trim() !== '') {
                    spaceId = msg.wwsSpaceId.trim();
                } else {
                    node.status({fill:"red", shape:"dot", text:"No Space Id"});
                    node.error("wws-message-post: Missing required input in msg object: wwsSpaceId");
                    return;
                }
            }
            //
            //  Check decoration
            //
            msg = _prepareAppMessage(config, msg, thePayload);
            //
            //  Prepare the request
            //
            var req = {
            		method: 'POST',
            		uri: this.application.getApiUrl() + "/v1/spaces/" + spaceId + "/messages",
            		body: msg.reqBody
            };
            //
            //  Fallback to support external provided tokens
            //
            if (msg.wwsToken) {
                req.headers = {
                    Authorization: "Bearer" + msg.wwsToken
                };
            }
            //
            //  Execute the request
            //
            node.status({fill:"blue", shape:"dot", text:"Sending message..."});
            node.application.wwsRequest(req)
            .then((response) => {
                msg.payload = response;
                delete msg.reqBody;
                node.status({fill:"green", shape:"dot", text:"Message sent"});
                node.send(msg);
                //
                //  Reset visual status on success
                //
                setTimeout(() => {node.status({});}, 2000);
            })
            .catch((error) => {
                node.status({fill:"red", shape:"dot", text:"Sending message failed!"});
            		node.error(error);
            });
        });
        this.on('close', function(removed, done) {
            if (removed) {
                // This node has been deleted
            } else {
                // This node is being restarted
            }
            done();
        });
    }
    RED.nodes.registerType("wws-message-post",WWSAppMessageNode);
};
