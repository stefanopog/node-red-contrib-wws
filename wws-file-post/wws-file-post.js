module.exports = function(RED) {
  function wwsFilePostNode(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    //Check for token on start up
    if (!node.application) {
      node.error("Please configure your Watson Workspace App first!");
      node.status({fill: "red", shape: "dot", text: "token unavailable"});
    }

    this.on("input", function(msg) {

      //Input validation 
      if (!msg.wwsFile && !msg.wwsImage) {
        node.error("Missing required input in msg object: [msg.wwsFile | msg.wwsImage]");
        node.status({fill: "red", shape: "dot", text: "missing input: [wwsFile | wwsImage]"});
        return;
      }
      var space = msg.wwsSpaceId || config.space;
      if (!space) {
        node.error("Missing required input: [spaceId | msg.wwsSpaceId]");
        node.status({fill: "red", shape: "dot", text: "missing input: spaceId"});
        return;
      }
      var file = msg.wwsFile;
      if (file && !file.options) {
        node.error("File object is not provided in the correct format. Please check the node help for details!");
        node.status({fill: "red", shape: "dot", text: "incorrect format: msg.wwsFile"});
        return;
      }
      if (msg.wwsImage) {
        if (!msg.wwsImage.options) {
          node.error("Image object is not provided in the correct format. Please check the node help for details!");
          node.status({fill: "red", shape: "dot", text: "incorrect format: msg.wwsImage"});
          return;
        } else {
          file = msg.wwsImage;
        }
      }

      let uri = this.application.getApiUrl() + "/v1/spaces/" + space + "/files";
      if (file.dimension) {
        uri +="?dim="+file.dimension.width+"x"+file.dimension.height;
      }

      var req = {
        method: 'POST',
        uri: uri,
        formData: {
          file: file
        }
      }

      //Fallback to support external provided tokens
      if (msg.wwsToken) {
        req.headers = {
            Authorization: "Bearer" + msg.wwsToken
        };
      }
    

      node.status({fill:"blue", shape:"dot", text:"Sending file..."});
      node.application.wwsRequest(req)
      .then((response) => {
          node.status({fill:"green", shape:"dot", text:"File sent"});
          msg.payload = response;
          delete msg.wwsFile;
          delete msg.wwsImage;
          node.send(msg);
          setTimeout(() => {
              node.status({});
          }, 2000);
      })
      .catch((error) => {
          node.status({fill:"red", shape:"dot", text:"Sending file failed!"});
        node.error(error);
      });
    });
  }
  RED.nodes.registerType("wws-file-post", wwsFilePostNode);
};
