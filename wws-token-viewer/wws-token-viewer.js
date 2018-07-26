module.exports = function(RED) {
    "use strict";
    const OAuth2 = require('simple-oauth2');
    function wwsTokenViewer(config) {
        RED.nodes.createNode(this, config);
        this.application = RED.nodes.getNode(config.application);
        var node = this;

        //Check for token on start up
        if (!node.application) {
            node.error("Please configure your Watson Workspace App first!");
            node.status({fill: "red", shape: "dot", text: "token unavailable"});
            return;
        }

        var intervalObj = undefined;
        if (config.refreshPeriod>0) {
            node.warn("Token refresh Period has been set to " + config.refreshPeriod + " min");
            node.checkToken(config.application);
            let pollingPeriod = config.refreshPeriod*60*1000;

            intervalObj = setInterval(() => {
                node.status({fill: "yellow", shape: "dot", text: "refreshing token..."});
                node.application.refreshToken()
                .then((success) => {
                    node.warn("Token " + success.id + " has been refreshed!")
                    node.status({fill: "green", shape: "dot", text: "token refreshed"});
                })
                .catch((error) => {
                    node.error(error);
                    node.status({fill: "red", shape: "dot", text: "token uninitialized"});
                });
            }, pollingPeriod);
        } else {
            node.warn(
                `Token refresh has been disabled.
                Refresh Period has been set to ` + config.refreshPeriod + `
                In order to enable refresh token - set a value greater than 0`
            );
            node.status({fill: "grey", shape: "dot", text: "refresh disabled"});
        }

        this.on("input", function(msg) {
            //Input validation
            node.checkToken(config.application);

            //just bypassing the msg
            node.send(msg);

        });
        this.on('close', function(removed, done) {
            clearInterval(intervalObj);
            if (removed) {
                // This node has been deleted
            } else {
                // This node is being restarted
            }
            done();
        });
    }
    RED.nodes.registerType("wws-token-viewer", wwsTokenViewer);

    wwsTokenViewer.prototype.checkToken = function(id) {
        var node = this;
        let credentials = RED.nodes.getCredentials(id);
        const oauth2 = OAuth2.create(node.application.getCredentials());
        if (credentials.token) {
            let tokenHelper = oauth2.accessToken.create(credentials.token);
            if (tokenHelper.expired()) {
                node.status({fill: "yellow", shape: "dot", text: "token expired"});
            } else {
                node.status({fill: "green", shape: "dot", text: "token available"});
            }
        } else {
            node.status({fill: "red", shape: "dot", text: "token unavailable"});
        }
    }
};
