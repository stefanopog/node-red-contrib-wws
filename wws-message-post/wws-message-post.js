
module.exports = function(RED) {
    "use strict";

    function WWSAppMessageNode(config) {
        RED.nodes.createNode(this,config);
        let stringOrDefault = (value, defaultValue) => {
            return typeof value == 'string' && value.length > 0 ? value : defaultValue;
        };
        this.color = stringOrDefault(config.color, "#11ABA5");
        this.avatar = stringOrDefault(config.avatar, undefined);
        this.spaceId = stringOrDefault(config.spaceId, undefined);
        this.picture = stringOrDefault(config.picture, undefined);
        
        //Get the application config node
        this.application = RED.nodes.getNode(config.application);
        var node = this;
        
        //Check for token on start up
        if (!node.application) {
            node.error("wws-message-post: Please configure your Watson Workspace App first!");
            node.status({fill: "red", shape: "dot", text: "token unavailable"});
        }

        this.on('input', function(msg) {

            if (!msg.payload) {
                node.status({fill:"red", shape:"dot", text:"No Payload"});
                node.error("wws-message-post: Missing required input in msg object: payload");
                return;
            }
            if (!msg.wwsSpaceId && !node.spaceId) {
                node.status({fill:"red", shape:"dot", text:"No Payload"});
                node.error("wws-message-post: Missing required input in msg object: wwsSpaceId");
                return;
            }
            msg.wwsSpaceId = msg.wwsSpaceId ? msg.wwsSpaceId : node.spaceId;

            msg = _prepareAppMessage(this, msg);
            var req = {
            		method: 'POST',
            		uri: this.application.getApiUrl() + "/v1/spaces/" + msg.wwsSpaceId + "/messages",
            		body: msg.reqBody
            }

            //Fallback to support external provided tokens
            if (msg.wwsToken) {
                req.headers = {
                    Authorization: "Bearer" + msg.wwsToken
                };
            }
            node.status({fill:"blue", shape:"dot", text:"Sending message..."});
            node.application.wwsRequest(req)
            .then((response) => {
                node.status({fill:"green", shape:"dot", text:"Message sent"});
                msg.payload = response;
                delete msg.reqBody;
                node.send(msg);
                setTimeout(() => {
                    node.status({});
                }, 2000);
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

    function _prepareAppMessage(node, msg) {
        //Check for defaults
        var annotation = {
            "type": "generic",
            "version": 1.0
        };
        if (msg.avatar || node.avatar) {
            annotation.actor = {"name": msg.avatar ? msg.avatar:node.avatar};
        }
        if (msg.color || node.color) {
            annotation.color = msg.color?msg.color:node.color;
        }
        if (msg.title) {
            annotation.title = msg.title;
        }
        annotation.text = msg.payload;
        var reqBody = {
            "type": "appMessage",
            "version": 1.0,
            "annotations":  [annotation]
        };
        msg.reqBody = reqBody;
        return msg;
    };
};
