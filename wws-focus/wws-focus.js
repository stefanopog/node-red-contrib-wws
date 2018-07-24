var request = require("request");
var rp = require("request-promise-native");

module.exports = function(RED) {
  function wwsFocusNode(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    //Check for token on start up
    if (!node.application || !node.application.hasAccessToken()) {
      node.error("Please configure your Watson Workspace App first!");
      node.status({fill: "red", shape: "dot", text: "token unavailable"});
    }
    function _isInitialized() {
      let token;
      if (node.application && node.application.hasAccessToken()) {
          token = node.application.getAccessToken(node);
      }
      return (token) ? true : false;
    };

    this.on("input", function(msg) {
      var text = msg.payload || config.theText;
      if (!text) {
        node.error("FOCUS : Missing required input: PAYLOAD");
        return;
      }

      let host = node.application &&  node.application.getApiUrl() || "https://api.watsonwork.ibm.com";
      let bearerToken = node.application.getAccessToken(node).access_token;

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
          _isInitialized();
      }, 2000);
    });
    this.releaseInterval = (intervalObj) => {
      clearInterval(intervalObj);
    };
    if (!_isInitialized()) {
        const intervalObj = setInterval(() => {
            if (_isInitialized()) {
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
