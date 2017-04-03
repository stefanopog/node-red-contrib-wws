var request = require("request");
var rp = require("request-promise-native");

module.exports = function(RED) {
  function wwsMessagePostNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    this.on("input", function(msg) {
      this.application = RED.nodes.getNode(config.application);
      if(this.application) {
        this.application.getAccessToken().then(function(auth) {
          var actor = {
            avatar: "",
            name: "Node Red",
            url: ""
          }
          wwsMessagePost(config.space, auth.accessToken, actor, "red", msg.payload, msg.topic).then(() => {
            console.log("Successfully posted message to WWS.");
          }).catch((err) => {
            console.log("Error while posting message to WWS.", err);
          });
        }).catch(function(err) {
          console.log("Error while asking for access token.", err);
        });
      } else {
        this.error("No WWS Application configured.");
      }
    });
  }
  
  RED.nodes.registerType("wws-message-post", wwsMessagePostNode);

  // Helper functions
  function wwsMessagePost(space, accessToken, actor, color, text, title) {
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
