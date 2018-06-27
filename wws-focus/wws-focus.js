var request = require("request");
var rp = require("request-promise-native");

module.exports = function(RED) {
  function wwsFocusNode(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    //Check for token on start up
    const tokenFsm = node.application.getStateMachine();
    if (!tokenFsm) {
        node.error("Please configure your account information first!");
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

    this.on("input", function(msg) {
      var text = msg.payload || config.theText;
      if (!text) {
        node.error("FOCUS : Missing required input: PAYLOAD");
        return;
      }

      var accessToken = this.application.verifyAccessToken(tokenFsm.getAccessToken(), this);        
      var host = this.application.api;
      var bearerToken = msg.wwsToken || accessToken.token.access_token;

      _wwsFocusPost(bearerToken, text, host).then((res) => {
        if (res.errors) {
          msg.payload = res.errors;
          console.log('FOCUS : errors posting Focus');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "errors getting FOCUSes"});
          node.error("errors posting FOCUS", msg);
          return;
        } else {
          console.log('FOCUS: Succesfully retrieved');
          console.log(JSON.stringify(res, ' ', 2));
          msg.wwsFocuses = res;
          node.status({ fill: "green", shape: "dot", text: "FOCUSes retrieved" });
          node.send(msg)
          }
      }).catch((err) => {
        console.log("FOCUS : Error getting Focus.", err);
        node.status({ fill: "red", shape: "ring", text: "Error Getting FOCUSes..." });
        node.error("Error getting Focus.", err);
      });
      setTimeout(() => {
          node.isInitialized();
      }, 2000);
    });
    this.releaseInterval = (intervalObj) => {
      clearInterval(intervalObj);
    };
    if (!this.isInitialized()) {
        const intervalObj = setInterval(() => {
            if (this.isInitialized()) {
                this.releaseInterval(intervalObj);
            };
          }, 2000);
    };
  }

  RED.nodes.registerType("wws-focus", wwsFocusNode);

  // Helper functions
  function _wwsFocusPost(accessToken, theText, host) {
    var uri = host + "/v1/focus";
    var options = {
      method: "POST",
      uri: uri,
      headers: {
        Authorization: "Bearer " + accessToken
      },
      json: true,
      body : {text: theText}
    };
    return rp(options);
  }
}
