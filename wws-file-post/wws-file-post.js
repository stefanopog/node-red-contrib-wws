var request = require("request");
var rp = require("request-promise-native");

module.exports = function(RED) {
  function wwsFilePostNode(config) {
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

      const host = node.application &&  node.application.getApiUrl()|| "https://api.watsonwork.ibm.com";
      let bearerToken = node.application.getAccessToken(node).access_token;


      wwsFilePost(bearerToken, space, file, host).then((res) => {
        console.log(JSON.stringify(res, ' ', 2));
        console.log('File/image succesfully sent ');
        
        msg.payload = res;
        node.status({ fill: "green", shape: "dot", text: "Sending file..." });
        node.send(msg);
      }).catch((res) => {
        console.log("Error while posting file to WWS => " + JSON.stringify(res.error, " ", 2));
        node.status({ fill: "red", shape: "ring", text: "sending file failed..." });
      });
      setTimeout(() => {
          _isInitialized();
      }, 2000);
    });
    _releaseInterval = (intervalObj) => {
      clearInterval(intervalObj);
    };
    if (!_isInitialized()) {
        const intervalObj = setInterval(() => {
            if (_isInitialized()) {
                _releaseInterval(intervalObj);
            }
          }, 2000);
    }
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
};
