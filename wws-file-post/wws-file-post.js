var request = require("request");
var rp = require("request-promise-native");

module.exports = function(RED) {
  function wwsFilePostNode(config) {
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
      if (!msg.file && !msg.image) {
        node.error("Missing required input in msg object: [image | file]");
        return;
      }
      var space = msg.spaceId || config.space;
      if (!space) {
        node.error("Missing required input: spaceId");
        return;
      }
      var accessToken = this.application.verifyAccessToken(tokenFsm.getAccessToken(), this);        
      var host = this.application.api;
      var bearerToken = msg.token || accessToken.token.access_token;
      var file = msg.file;
      if (file && !file.options) {
        node.error("File object is not provided in the correct format. Please check the node help for details!");
        return;
      }
      var dimension = {};
      if (msg.image && !msg.image.options) {
        node.error("Image object is not provided in the correct format. Please check the node help for details!");
        return;
      } else {
        file = msg.image;
      }
      wwsFilePost(bearerToken, space, file, host).then(() => {
        node.status({ fill: "green", shape: "dot", text: "Sending file..." });
      }).catch((err) => {
        console.log("Error while posting file to WWS.", err);
        node.status({ fill: "red", shape: "ring", text: "sending file failed..." });
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

  RED.nodes.registerType("wws-file-post", wwsFilePostNode);

  // Helper functions
  function wwsFilePost(accessToken, space, file, host) {
    var uri = host + "/v1/spaces/" + space + "/files";
    //Optional send dimensions - only applicable for images

    if (file.dimension) {
      uri +="?dim="+file.dimension.width+"x"+file.dimension.height;
    }
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
