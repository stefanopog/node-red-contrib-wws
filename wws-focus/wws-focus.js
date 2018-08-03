module.exports = function(RED) {
  "use strict";

  function wwsFocusNode(config) {
    RED.nodes.createNode(this, config);
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
      node.error("wwsFocusNode: Please configure your Watson Workspace App first!");
    }
    //
    //  Start Real Processing
    //
    this.on("input", function(msg) {
      var theText = msg.payload || config.theText;
      if (!theText) {
        node.status({fill: "red", shape: "dot", text: "No Payload"});
        node.error("wwsFocusNode: Missing required input: PAYLOAD");
        return;
      }
      var req = {
        method: "POST",
        uri: this.application.getApiUrl() + "/v1/focus",
        json: true,
        body : {text: theText}
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
      //  Execute operation
      //
      node.status({fill:"blue", shape:"dot", text:"Getting Focus..."});
      node.application.wwsRequest(req)
      .then((res) => {
        if (res.errors) {
          msg.payload = res.errors;
          console.log('wwsFocusNode: errors posting Focus');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "errors getting FOCUSes"});
          node.error("wwsFocusNode: errors getting FOCUSes", msg);
        } else {
          console.log('wwsFocusNode: Succesfully retrieved');
          msg.wwsFocuses = res;
          node.status({ fill: "green", shape: "dot", text: "FOCUSes retrieved" });
          node.send(msg);
          //
          //  Reset visual status on success
          //
          setTimeout(() => {node.status({});}, 2000);
        }
      })
      .catch((err) => {
        console.log("wwsFocusNode : Error getting Focus.", err);
        node.status({fill: "red", shape: "ring", text: "Error Getting FOCUSes..." });
        node.error("wwsFocusNode: Error getting Focus.", err);
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

  RED.nodes.registerType("wws-focus", wwsFocusNode);
}
