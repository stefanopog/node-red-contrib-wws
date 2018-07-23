
module.exports = function(RED) {
    "use strict";
    const urllib = require("url");
    const http = require("follow-redirects").http;
    const https = require("follow-redirects").https;

    function WWSAppMessageNode(config) {
        RED.nodes.createNode(this,config);
        let stringOrDefault = (value, defaultValue) => {
            return typeof value == 'string' && value.length > 0 ? value : defaultValue;
        };
        this.account = config.account;
        this.color = stringOrDefault(config.color, "#11ABA5");
        this.avatar = stringOrDefault(config.avatar, undefined);
        this.spaceId = stringOrDefault(config.spaceId, undefined);
        this.picture = config.picture;
        
        //Get the account config node
        this.accountConfig = RED.nodes.getNode(this.account);
        this.accountConfigCredentials = RED.nodes.getCredentials(this.account);
        var node = this;
        //Check for token on start up
        var tokenFsm;
        if (!node.accountConfig || !node.accountConfig.getStateMachine()) {
            node.error("Please configure your account information first!");
            tokenFsm = {};
        } else {
            tokenFsm = node.accountConfig.getStateMachine();
        }

        this.isInitialized = () => {
            var initialized = false;
            if (tokenFsm.getAccessToken()){
                node.status({fill: "green", shape: "dot", text: "token available"});
                initialized = true;
            } else {
                node.status({fill: "grey", shape: "dot", text: "uninitialized token"});
            }
            return initialized;
            
        };
        var defaultTimeout = 4500;
        if (RED.settings.httpRequestTimeout) { 
            this.reqTimeout = parseInt(RED.settings.httpRequestTimeout) || defaultTimeout; 
        } else { 
            this.reqTimeout = defaultTimeout; 
        }
        //ToDo -> Properties
        var apiUrl = node.accountConfig.api || "https://api.watsonwork.ibm.com";
        var createMessagePath = "/v1/spaces/:spaceId/messages";
        
        this.prepareMessage = (msg) =>{
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
        //Create Message Body and send it.
        this.sendMessage = (accessToken, msg) => {
            node.status({fill:"blue",shape:"dot",text: "sending message"});
            //Get access token
            let bearerToken = accessToken.token.access_token;
            //set http method 
            var method = "POST";
            //set authorization and content-type headers
            var headers = {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + bearerToken           
            };
            //create target URL
            var url = apiUrl + createMessagePath.replace("/:spaceId/", "/" + msg.wwsSpaceId + "/");
            var opts = urllib.parse(url);
            opts.method = method;
            opts.headers = headers;
            var payload = JSON.stringify(msg.reqBody);
            var req = ((/^https/.test(url))?https:http).request(opts,function(res) {
                // Force NodeJs to return a Buffer (instead of a string)
                // See https://github.com/nodejs/node/issues/6038
                res.setEncoding(null);
                delete res._readableState.decoder;

                msg.statusCode = res.statusCode;
                msg.headers = res.headers;
                msg.responseUrl = res.responseUrl;
                msg.payload = [];

                // msg.url = url;   // revert when warning above finally removed
                res.on('data',function(chunk) {
                    if (!Buffer.isBuffer(chunk)) {
                        // if the 'setEncoding(null)' fix above stops working in
                        // a new Node.js release, throw a noisy error so we know
                        // about it.
                        throw new Error("HTTP Request data chunk not a Buffer");
                    }
                    msg.payload.push(chunk);
                });
                res.on('end',function() {

                    // Check that msg.payload is an array - if the req error
                    // handler has been called, it will have been set to a string
                    // and the error already handled - so no further action should
                    // be taken. #1344
                    if (Array.isArray(msg.payload)) {
                        // Convert the payload to the required return type
                        msg.payload = Buffer.concat(msg.payload);
                        msg.payload = msg.payload.toString('utf8'); // txt
                        try { msg.payload = JSON.parse(msg.payload); } // obj
                        catch(e) { node.warn("Could not convert the response to a JSON format!"); }
                        node.isInitialized();
                    }
                    console.log('Message-Post : sending the following message :');
                    console.log(JSON.stringify(msg, ' ', 2));
                    switch (msg.statusCode) {
                        case 500:
                            if (msg.payload.message) {
                                node.error("Message could not be delivered to Space! " + msg.payload.message);
                            } else if (res.error){
                                node.error("Message could not be delivered to Space! " + msg.payload.error);
                            } else {
                                node.error("Message could not be delivered to Space! ");
                            }
                            break;
                        case 403:
                            node.error("Message could not be delivered to Space! " + "The space you are trying to send the message to does not exist anymore!");
                            break;
                        case 401:
                            node.error("Message could not be delivered to Space! " + "No valid token has been provided! Check the status of this node!");
                            break;
                        case 400:
                            node.error("Message could not be delivered to Space! " + "Improperly formed message body.");
                            break;
                        case 201:
                            node.send(msg);
                            break;
                    }
                    return new Promise((resolve) => {
                        if (msg.statusCode>201) {
                            node.status({fill:"red",shape:"dot",text: "message failed"});
                        } else {
                            node.status({fill:"green",shape:"dot",text: "message send"});
                            console.log(JSON.stringify(msg, ' ', 2));
                        }
                        resolve();
                    }).then(() => {
                        setTimeout(() => {
                            node.isInitialized();
                        }, 2000);
                    });

                });
            });
            req.setTimeout(node.reqTimeout, function() {
                node.error("TIMEOUT: Could not receive an answer within the given timeframe!",msg);
                setTimeout(function() {
                    node.status({fill:"red", shape:"ring", text: "TIMEOUT: Could not receive an answer within the given timeframe!"});
                },10);
                req.abort();
            });
            req.on('error',function(err) {
                node.error(err,msg);
                msg.payload = err.toString() + " : " + url;
                msg.statusCode = err.code;
                node.status({fill:"red",shape:"ring",text: err.code});
                node.error(JSON.stringify(msg));
            });
            if (payload) {
                req.write(payload);
            }
            req.end();
        };


        this.on('input', function(msg) {
            const fsm = node.accountConfig.getStateMachine();
            if (!fsm.is('has_token')) {
                node.error("Please configure your account information first!");
                node.status({fill: "red", shape: "dot", text: "uninitialized token"});
                return;
            }
            node.isInitialized();
            if (!msg.payload) {
                node.error("Payload may not be empty!");
                return;
            }
            if (!msg.wwsSpaceId && !node.spaceId) {
                node.error("You need to define a spaceId to which the message needs to be send to!");
                return;
            }
            msg.wwsSpaceId = msg.wwsSpaceId ? msg.wwsSpaceId : node.spaceId;
            let accessToken = fsm.appToken;

            if (accessToken.expired()) {
                fsm.invalidate(node);
                fsm.renew(node).then((accessToken) => {
                    node.sendMessage(accessToken, node.prepareMessage(msg));
                });
                return;
            } else {
                node.sendMessage(accessToken, node.prepareMessage(msg));
            }
        });
        this.on('close', function(removed, done) {
            if (removed) {
                // This node has been deleted
            } else {
                // This node is being restarted
            }
            done();
        });

        this.releaseInterval = (intervalObj) => {
            clearInterval(intervalObj);
        };
        if (!this.isInitialized()) {
            const intervalObj = setInterval(() => {
                if (this.isInitialized()) {
                    this.releaseInterval(intervalObj);
                }
              }, 2000);
        }

    }
    RED.nodes.registerType("wws-message-post",WWSAppMessageNode);
};
