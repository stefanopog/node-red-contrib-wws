var request = require("request");
var rp = require("request-promise-native");

module.exports = function(RED) {
  function wwsFilePostNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    this.on("input", function(msg) {
      this.application = RED.nodes.getNode(config.application);
      if(this.application) {
        this.application.getAccessToken().then(function(auth) {
          var space = config.space;
          if(msg.spaceId) {
            space = msg.spaceId;
          }

          wwsFilePost(auth.accessToken, space, msg.file).then(() => {
            console.log("Successfully posted file to WWS.");
            this.status({ fill: "green", shape: "dot", text: "connected" });
          }).catch((err) => {
            console.log("Error while posting file to WWS.", err);
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

  RED.nodes.registerType("wws-file-post", wwsFilePostNode);

  // Helper functions
  function wwsFilePost(accessToken, space, file) {
    var host = "https://api.watsonwork.ibm.com";
    var uri = host + "/v1/spaces/" + space + "/files";
    var options = {
      method: "POST",
      uri: uri,
      headers: {
        Authorization: "Bearer " + accessToken
      },
      json: true,
      formData: {
        file: file
      }
    };
    return rp(options);
  }
}
