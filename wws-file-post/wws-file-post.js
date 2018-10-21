/**
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/
module.exports = function(RED) {
  function wwsFilePostNode(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    //Check for token on start up
    if (!node.application) {
      node.status({fill: "red", shape: "dot", text: "token unavailable"});
      node.error("wwsFilePost: Please configure your Watson Workspace App first!");
      return;
    }

    this.on("input", function(msg) {

      //Input validation 
      if (!msg.wwsFile && !msg.wwsImage) {
        node.status({fill: "red", shape: "dot", text: "missing input: [wwsFile | wwsImage]"});
        node.error("wwsFilePost: Missing required input in msg object: [msg.wwsFile | msg.wwsImage]");
        return;
      }
      var space = config.space || msg.wwsSpaceId;
      if (!space || (space.trim() === '')) {
        node.status({fill: "red", shape: "dot", text: "missing input: spaceId"});
        node.error("wwsFilePost: Missing required input: [spaceId | msg.wwsSpaceId]");
        return;
      }
      var file = msg.wwsFile;
      if (file && !file.options) {
        node.status({fill: "red", shape: "dot", text: "incorrect format: msg.wwsFile"});
        node.error("wwsFilePost: File object is not provided in the correct format. Please check the node help for details!");
        return;
      }
      if (msg.wwsImage) {
        if (!msg.wwsImage.options) {
          node.status({fill: "red", shape: "dot", text: "incorrect format: msg.wwsImage"});
          node.error("wwsFilePost: Image object is not provided in the correct format. Please check the node help for details!");
          return;
        } else {
          file = msg.wwsImage;
        }
      }

      let uri = this.application.getApiUrl() + "/v1/spaces/" + space + "/files";
      if (file.dimension) {
        uri +="?dim=" + file.dimension.width + "x" + file.dimension.height;
      }

      var req = {
        method: 'POST',
        uri: uri,
        formData: {
          file: file
        }
      };

      //Fallback to support external provided tokens
      if (msg.wwsToken) {
        req.headers = {
            Authorization: "Bearer" + msg.wwsToken
        };
      }
    

      node.status({fill:"blue", shape:"dot", text:"Sending file..."});
      node.application.wwsRequest(req)
      .then((response) => {
          msg.payload = response;
          delete msg.wwsFile;
          delete msg.wwsImage;
          node.status({fill:"green", shape:"dot", text:"File sent"});
          node.send(msg);
          //
          //  Reset visual status on success
          //
          setTimeout(() => {node.status({});}, 2000);
      })
      .catch((error) => {
          node.status({fill:"red", shape:"dot", text:"Sending file failed!"});
          node.error('wwsFilePost: error sending file', error);
      });
    });
  }
  RED.nodes.registerType("wws-file-post", wwsFilePostNode);
};
