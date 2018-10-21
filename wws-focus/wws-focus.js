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
  "use strict";

  function wwsFocusNode(config) {
    RED.nodes.createNode(this, config);
    //   
    //  Get the application config node
    //
    this.application = RED.nodes.getNode(config.application);
    var node = this;
    //
    //  Check for token on start up
    //
    if (!node.application) {
      node.status({fill: "red", shape: "dot", text: "token unavailable"});
      node.error("wwsFocusNode: Please configure your Watson Workspace App first!");
    }
    //
    //  Start Real Processing
    //
    this.on("input", (msg) => {
      //
      //  get payload
      //
      var theText = '';
      if ((config.theText === '') && 
          ((msg.payload === undefined) || (msg.payload === ''))) {
        //
        //  There is an issue
        //
        console.log("wwsFocusNode: Missing PAYLOAD");
        node.status({fill: "red", shape: "dot", text: "No Payload"});
        node.error("wwsFocusNode: Missing required input: PAYLOAD");
        return;
      }
      if (config.theText !== '') {
        theText = config.theText;
      } else {
        theText = msg.payload;
      }
      var req = {
        method: "POST",
        uri: this.application.getApiUrl() + "/v1/focus",
        json: true,
        body : {text: theText}
      };
      //
      //  Fallback to support external provided tokens
      //
      if (msg.wwsToken) {
        req.headers = {
            Authorization: "Bearer" + msg.wwsToken
        };
      }
      //
      //  Execute operation
      //
      node.status({fill:"blue", shape:"dot", text:"Getting Focus..."});
      node.application.wwsRequest(req)
      .then((res) => {
        if (res.errors) {
          msg.payload = res.errors;
          console.log('wwsFocusNode: errors posting Focus');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "errors getting FOCUSes"});
          node.error("wwsFocusNode: errors getting FOCUSes", msg);
        } else {
          console.log('wwsFocusNode: Succesfully retrieved');
          msg.wwsFocuses = res;
          node.status({ fill: "green", shape: "dot", text: "FOCUSes retrieved" });
          node.send(msg);
          //
          //  Reset visual status on success
          //
          setTimeout(() => {node.status({});}, 2000);
        }
      })
      .catch((err) => {
        console.log("wwsFocusNode : Error getting Focus.", err);
        node.status({fill: "red", shape: "ring", text: "Error Getting FOCUSes..." });
        node.error("wwsFocusNode: Error getting Focus.", err);
      });
    });
    this.on('close', function(removed, done) {
      if (removed) {
          // This node has been deleted
      } else {
          // This node is being restarted
      }
      done();
    });
  }

  RED.nodes.registerType("wws-focus", wwsFocusNode);
};
