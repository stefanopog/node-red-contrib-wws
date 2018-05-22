var request = require("request");
var rp = require("request-promise-native");

module.exports = function(RED) {
  function wwsGraphQLNode(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    this.viewType = config.viewType;
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

    this.on("input", (msg) => {
      if (!msg.payload) {
        node.error("Missing required input in msg object: payload");
        return;
      }


      var accessToken = this.application.verifyAccessToken(tokenFsm.getAccessToken(), this);
      var bearerToken = msg.token || accessToken.token.access_token;
      var host = this.application.api;

      wwsGraphQL(bearerToken, host, msg._msgid, msg.payload, msg.operationName, msg.variables).then((res) => {
        this.status({ fill: "green", shape: "dot", text: "Sending query..." });
        if (res.error) {
          msg.payload = res.error;
        } else {
          msg.payload = res.data;
        }
        node.send(msg);
      }).catch((err) => {
        console.log("Error while posting GraphQL query to WWS.", err);
        this.status({ fill: "red", shape: "ring", text: "Sending query failed..." });
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

  RED.nodes.registerType("wws-graphql", wwsGraphQLNode);

  // Helper functions
  function wwsGraphQL(accessToken, host, requestId, query, operationName, variables) {
    var uri = host + "/graphql";
    if (operationName) {
      uri +="?operationName="+operationName; 
    }
    if (variables) {
      uri += (uri.includes("?") ? "&" : "?") + "variables="+variables;
    }
    var options = {
      method: "POST",
      uri: uri,
      headers: {
        "Authorization": "Bearer " + accessToken,
        "X-RequestId": requestId,
        "x-graphql-view": this.viewType
      },
      json: true,
      body: {
        query: query
      }
    };
    return rp(options);
  }
}
