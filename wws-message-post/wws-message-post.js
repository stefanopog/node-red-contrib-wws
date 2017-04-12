var request = require("request");
var rp = require("request-promise-native");

module.exports = function(RED) {
  function wwsMessagePostNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    this.on("input", (msg) => {
      this.application = RED.nodes.getNode(config.application);
      if(this.application) {
        this.application.getAccessToken().then((auth) => {
          var actor = {
            avatar: "",
            name: config.author,
            url: ""
          }
          var space = config.space;
          if(msg.spaceId) {
            space = msg.spaceId;
          }

          var text = String(msg.payload) || "";
          wwsMessagePost(auth.accessToken, space, actor, "red", text, msg.topic).then(() => {
            console.log("Successfully posted message to WWS.");
            this.status({ fill: "green", shape: "dot", text: "connected" });
          }).catch((err) => {
            console.log("Error while posting message to WWS.", err);
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

  RED.nodes.registerType("wws-message-post", wwsMessagePostNode);

  // Helper functions
  function wwsMessagePost(accessToken, space, actor, color, text, title) {
    var host = "https://api.watsonwork.ibm.com";
    var uri = host + "/v1/spaces/" + space + "/messages";
    var options = {
      method: "POST",
      uri: uri,
      headers: {
        Authorization: "Bearer " + accessToken
      },
      json: true,
      body: {
        annotations: [{
          actor: {
            avatar: actor.avatar,
            name: actor.name,
            url: actor.url
          },
          color: color,
          text: text,
          title: title,
          type: "generic",
          version: 1
        }],
        type: "appMessage",
        version: 1
      }
    };
    return rp(options);
  }
}
