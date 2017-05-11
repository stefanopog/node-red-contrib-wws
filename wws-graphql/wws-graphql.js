var request = require("request");
var rp = require("request-promise-native");

module.exports = function(RED) {
  function wwsGraphQLNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    this.on("input", (msg) => {
      this.application = RED.nodes.getNode(config.application);
      if(this.application) {
        this.application.getAccessToken().then((auth) => {
          wwsGraphQL(auth.accessToken, msg.query, msg.operationName, msg.variables).then((res) => {
            console.log("Successfully posted GraphQL query to WWS.");
            this.status({ fill: "green", shape: "dot", text: "connected" });

            var msgid = RED.util.generateId();
            res._msgid = msgid;
            node.send({ _msgid: msgid, response: res });
          }).catch((err) => {
            console.log("Error while posting GraphQL query to WWS.", err);
            this.status({ fill: "red", shape: "ring", text: "disconnected" });
          });
        }).catch(function(err) {
          console.log("Error while asking for access token.", err);
          this.status({ fill: "red", shape: "ring", text: "disconnected" });
        });
      } else {
        this.error("No WWS Application configured.");
        this.status({ fill: "red", shape: "ring", text: "disconnected" });
      }
    });
  }

  RED.nodes.registerType("wws-graphql", wwsGraphQLNode);

  // Helper functions
  function wwsGraphQL(accessToken, query, operationName, variables) {
    var host = "https://api.watsonwork.ibm.com";
    var uri = host + "/graphql";
    var options = {
      method: "POST",
      uri: uri,
      headers: {
        Authorization: "Bearer " + accessToken
      },
      json: true,
      body: {
        query: query,
        operationName: operationName,
        variables: variables
      }
    };
    return rp(options);
  }
}
