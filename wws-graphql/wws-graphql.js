var request = require("request");
var rp = require("request-promise-native");

module.exports = function (RED) {
  //
  //  Generic graphQL Node
  //
  function wwsGraphQLNode(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    //Check for token on start up
    const tokenFsm = node.application.getStateMachine();
    if (!tokenFsm) {
      node.error("Please configure your account information first!");
    }
    if (!this.isInitialized()) {
      const intervalObj = setInterval(() => {
        if (this.isInitialized()) {
          this.releaseInterval(intervalObj);
        };
      }, 2000);
    };

    this.on("input", (msg) => {
      if (!msg.payload) {
        console.log("No Account Info");
        node.status({fill:"red", shape:"dot", text:"No Account Info"});
        node.error("Missing required input in msg object: payload");
        return;
      }


      var accessToken = this.application.verifyAccessToken(tokenFsm.getAccessToken(), this);
      var bearerToken = msg.token || accessToken.token.access_token;
      var host = this.application.api;

      var viewType = "PUBLIC";
      if (config.wwsBetaFeatures) viewType += ',BETA';
      if (config.wwsExperimentalFeatures) viewType += ',EXPERIMENTAL';

      console.log('viewType = ' + viewType);

      wwsGraphQL(bearerToken, host, msg.payload, msg.operationName, msg.variables, viewType).then((res) => {
        if (res.errors) {
          msg.payload = res.errors;
          node.status({fill: "red", shape: "dot", text: "Errors from query"});
          console.log('errors from query');
          console.log(JSON.stringify(res.errors));
        } else {
          msg.payload = res.data;
          node.status({fill: "green", shape: "dot", text: "graphQL Query success"});
          console.log('Success from graphQL query');
          console.log(JSON.stringify(res.data));
        }
        node.send(msg);
      }).catch((err) => {
        console.log("Error while posting GraphQL query to WWS.", err);
        node.status({fill: "red", shape: "ring", text: "Sending query failed..."});
      });
      setTimeout(() => {node.isInitialized(); }, 2000);
    });
  }


  //
  //  This node gets the Annotation referred to by a message containing the "Action-Selected" actionId
  //
  function wwsValidateActions(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    //Check for token on start up
    const tokenFsm = node.application.getStateMachine();
    if (!tokenFsm) {
      console.log("No Account Info");
      node.status({fill:"red", shape:"dot", text:"No Account Info"});
      node.error("Please configure your account information first!");
    }
    if (!this.isInitialized()) {
      const intervalObj = setInterval(() => {
        if (this.isInitialized()) {
          this.releaseInterval(intervalObj);
        };
      }, 2000);
    };

    this.on("input", (msg) => {
      var referralMessageId;
      var actionId;
      var actionList;

      if ((config.wwsReferralMessageId === '') && 
          ((msg.wwsReferralMessageId === undefined) || (msg.wwsReferralMessageId === ''))) {
        //
        //  There is an issue
        //
        console.log("Missing referralMessageId Information");
        node.status({fill:"red", shape:"dot", text:"Missing referralMessageId"});
        node.error('Missing Bookmark URL', msg);
        return;
      }
      if (config.wwsReferralMessageId !== '') {
        referralMessageId = config.wwsReferralMessageId.trim();
      } else {
        referralMessageId = msg.wwsReferralMessageId.trim();
      }

      if ((config.wwsActionId === '') && 
          ((msg.wwsActionId === undefined) || (msg.wwsActionId === ''))) {
        //
        //  There is an issue
        //
        console.log("Missing actionId Information");
        node.status({fill:"red", shape:"dot", text:"Missing actionId"});
        node.error('Missing actionsId', msg);
        return;
      }
      if (config.wwsActionId !== '') {
        actionId = config.wwsActionId.trim();
      } else {
        actionId = msg.wwsActionId.trim();
      }

      if ((config.wwsActionsList === '') && 
          ((msg.wwsActionsList === undefined) || (msg.wwsActionsList === ''))) {
        //
        //  There is an issue
        //
        console.log("Missing ActionsList Information");
        node.status({fill:"red", shape:"dot", text:"Missing ActionsList"});
        node.error('Missing ActionsList', msg);
        return;
      }
      if (config.wwsActionsList !== '') {
        actionList = config.wwsActionsList.split(',');
      } else {
        actionList = msg.wwsActionsList.split(',');
      }
      //
      //  Check that the action to referred to by the incoming actions-selected is in the list
      //
      var selectedRule = -1;
      for (let i=0; i < actionList.length; i++) {
        if (matchRuleShort(actionId, actionList[i].trim())) {
            selectedRule = i;
          break;
        }
      }
      if (selectedRule === -1) {
        //
        //  Build an output array of messages where all the messages are NULL except the Last one
        //
        console.log('ActionId ' + actionId + ' does not match input ActionsList');
        var outArray = [];
        for (let i=0; i < actionList.length; i++) {
          outArray.push(null);
        }
        outArray.push({payload : actionId});
        node.send(outArray);
        return;
      }

      //
      //  At this point, we know that we are trying to match an ActionId which is in the list
      //
      //  If the ActionId represents a SLASH Command, we do not have to do much....
      //
      if (actionId.startsWith('/')) {
          //
          //  Build the output Array (as the node has multiple outputs)
          //  all the outputs will be initialized to NULL
          //
          var outArray = [];
          for (let i=0; i <= actionList.length; i++) {
            outArray.push(null);
          }
          //
          //  the array item corresponding to the selectedRule is filled with the result
          //
          outArray[selectedRule] = msg;
          //  
          //  Sends the output array
          //
          node.send(outArray);        
      }
      //
      //  If the ActionId is not a SLASH Command, then we need to get the one annotation from the referralMsessageId which
      //  corresponds to the Actios ID.
      //  So we are ready to build the graphQL query to retrieve the annotations 
      //
      var accessToken = this.application.verifyAccessToken(tokenFsm.getAccessToken(), this);
      var bearerToken = msg.token || accessToken.token.access_token;
      var host = this.application.api;
      var query = 'query getAnnotations { message(id: "' + referralMessageId + '"){annotations}}';

      //
      //  Retrieve the annotations for the given Message
      //
      wwsGraphQL(bearerToken, host, query, '', '', "PUBLIC")
      .then((res) => {
        if (res.errors) {
          //
          //  Should NOT BE...
          //
          msg.payload = res.errors;
          node.status({fill: "red", shape: "dot", text: "Errors from query"});
          console.log('errors from query');
          console.log(JSON.stringify(res.errors));
          node.error('Missing ActionsList', msg);
        } else {
          //
          //  Ok, we got the array of annotations...
          //
          node.status({fill: "green", shape: "dot", text: "Annotations retrieved..."});
          console.log('Success from graphQL query : Annotations retrieved');
          console.log(JSON.stringify(res.data));
          //
          //  Now we have the annotations. Check to find the one that is "message-focus" and corresponds to the lens=ActionId
          //
          if (res.data.message !== null) {
            for (let i=0; i < res.data.message.annotations.length; i++) {
              let intent = JSON.parse(res.data.message.annotations[i]);
              if ((intent.type === "message-focus") && (intent.lens === actionId)) {
                  msg.payload = intent;
                break;
              }
            }
          } else {
            msg.payload = {};
          }
          //
          //  Build the output Array (as the node has multiple outputs)
          //  all the outputs will be initialized to NULL
          //
          var outArray = [];
          for (let i=0; i <= actionList.length; i++) {
            outArray.push(null);
          }
          //
          //  the array item corresponding to the selectedRule is filled with the result
          //
          outArray[selectedRule] = msg;
          //  
          //  Sends the output array
          //
          node.send(outArray);
        }})
      .catch((err) => {
        msg.payload = err;
        console.log("Error while posting GraphQL query to WWS.", err);
        node.status({fill: "red", shape: "ring", text: "Sending query failed..."});
        node.error('Error while posting GraphQL query to WWS.', msg);
      });
      setTimeout(() => {node.isInitialized();}, 2000);
    });
  }

  RED.nodes.registerType("wws-graphql", wwsGraphQLNode);

  RED.nodes.registerType("wws-validateActions", wwsValidateActions);

  //
  //  Helper functions
  //
  function wwsGraphQL(accessToken, host, query, operationName, variables, viewType) {
    var uri = host + "/graphql";
    if (operationName) {
      uri += "?operationName=" + operationName;
    }
    if (variables) {
      uri += (uri.includes("?") ? "&" : "?") + "variables=" + variables;
    }
    var options = {
      method: "POST",
      uri: uri,
      headers: {
        "Authorization": "Bearer " + accessToken,
        "x-graphql-view": viewType
      },
      json: true,
      body: {
        query: query
      }
    };
    return rp(options);
  }

  //
  //  This code comes form the following article : https://stackoverflow.com/questions/26246601/wildcard-string-comparison-in-javascript
  //
  //
  //  This is the "Short code"
  //
  function matchRuleShort(str, rule) {
    return new RegExp("^" + rule.split("*").join(".*") + "$").test(str);
  }
  //
  //  And this is the full code which serves as explanation to the "short code" 
  //
  function matchRuleExpl(str, rule) {
    // "."  => Find a single character, except newline or line terminator
    // ".*" => Matches any string that contains zero or more characters
    rule = rule.split("*").join(".*");

    // "^"  => Matches any string with the following at the beginning of it
    // "$"  => Matches any string with that in front at the end of it
    rule = "^" + rule + "$"

    //Create a regular expression object for matching string
    var regex = new RegExp(rule);

    //Returns true if it finds a match, otherwise it returns false
    return regex.test(str);
  }
  //
  //  Examples
  //
  //alert(
  //  "1. " + matchRuleShort("bird123", "bird*") + "\n" +
  //  "2. " + matchRuleShort("123bird", "*bird") + "\n" +
  //  "3. " + matchRuleShort("123bird123", "*bird*") + "\n" +
  //  "4. " + matchRuleShort("bird123bird", "bird*bird") + "\n" +
  //  "5. " + matchRuleShort("123bird123bird123", "*bird*bird*") + "\n"
  //);
  //
  //  End of code coming form the following article : https://stackoverflow.com/questions/26246601/wildcard-string-comparison-in-javascript
  //  

  this.isInitialized = () => {
    var initialized = false;
    if (tokenFsm.getAccessToken()) {
      node.status({fill: "green", shape: "dot", text: "token available"});
      initialized = true;
    } else {
      node.status({fill: "grey", shape: "dot", text: "uninitialized token"});
    }
    return initialized;
  };
  this.releaseInterval = (intervalObj) => {
    clearInterval(intervalObj);
  };
}