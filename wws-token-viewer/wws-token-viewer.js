/**
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/
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
                    node.warn("Token " + success.id + " has been refreshed!");
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
            let token = node.checkToken(config.application);

            if (token) {
                //Adding token to msg object if available
                //can be used to overwrite (if required) the token
                msg.wwsToken = token;
            }
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
            return tokenHelper.token;
        } else {
            node.status({fill: "red", shape: "dot", text: "token unavailable"});
        }
    };
};
