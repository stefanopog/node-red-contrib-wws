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
      if (!msg.wwsFile && !msg.wwsImage) {
        node.error("Missing required input in msg object: [image | file]");
        return;
      }
      var space = msg.wwsSpaceId || config.space;
      if (!space) {
        node.error("Missing required input: spaceId");
        return;
      }

      
      var file = msg.wwsFile;
      if (file && !file.options) {
        node.error("File object is not provided in the correct format. Please check the node help for details!");
        return;
      }

      if (msg.wwsImage) {
        if (!msg.wwsImage.options) {
          node.error("Image object is not provided in the correct format. Please check the node help for details!");
          return;
        } else {
          file = msg.wwsImage;
        }
      }

      var accessToken = this.application.verifyAccessToken(tokenFsm.getAccessToken(), this);        
      var host = this.application.api;
      var bearerToken = msg.token || accessToken.token.access_token;

      wwsFilePost(bearerToken, space, file, host).then((res) => {
        if (res.errors) {
          msg.payload = res.errors;
          console.log('errors posting file');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "errors posting file"});
          node.error("errors posting file", msg);
          return;
        } else {
          console.log('File/image succesfully sent ');
          console.log(JSON.stringify(res.data, ' ', 2));
          msg.payload = res.data;
          node.status({ fill: "green", shape: "dot", text: "Sending file..." });
          node.send(msg)
          }
      }).catch((err) => {
        console.log("Error while posting file to WWS.", err);
        node.status({ fill: "red", shape: "ring", text: "sending file failed..." });
        node.error("Error while posting file to WWS.", err);
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
console.log(file);
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
