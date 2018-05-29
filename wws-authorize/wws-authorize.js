module.exports = function(RED) {
    "use strict";
    function WWSTokenNode(config) {
        RED.nodes.createNode(this,config);

        this.account = config.account;
        this.scope = config.scope;
        this.userId = config.user;
        
        this.on('input', function(msg) {

            var token = getAccessToken(this.account, this.userId);
            if (token.expired()) {
                token = refreshToken(this.account, this.userId);
            }
            msg.token = token.access_token;
            node.send(msg);
        });
        
        this.on('close', function(removed, done) {
            if (removed) {
                // This node has been deleted
            } else {
                // This node is being restarted
            }
            done();
        });
        //Check for token on start up
        this.isInitialized = () => {
            var initialized = false;
            var token = getAccessToken(this.account, this.userId);
            if (token && token.access_token){
                this.status({fill: "green", shape: "dot", text: token.displayName + " [" + token.id + "]"});
                initialized = true;
            } else {
                this.status({fill: "red", shape: "dot", text: "missing access token"});
            }
            return initialized;
        };
        this.releaseInterval = (intervalObj) => {
            clearInterval(intervalObj);
        };
        if (!this.isInitialized()) {
            this.error("Please authorize the app first!");
        };


    }
    RED.nodes.registerType("wws-authorize",WWSTokenNode);
    
    function getAccessToken(account, userId) {
        var oauthConfig = RED.settings.get(account);
        var token;
        if (oauthConfig && oauthConfig.user) {
            token = oauthConfig.user.token;
        }
        if (!token) {
            token = {};
        }
        return token;
    }
    
    function refreshToken(account, userId) {
        var oauthConfig = RED.settings.get(account);
        var token;
        if (oauthConfig.user) {
            token = oauthConfig.user.token;
        }
        if (!token) {
            token = {};
        }
        try {
            token.refresh();
        } catch (error) {
            console.log('Error refreshing token: ', error.message);
        }
        oauthConfig.user.token = token;
        RED.settings.set(account, oauthConfig);
        return token;
    }
    
}