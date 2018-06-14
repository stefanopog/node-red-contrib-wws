var request = require("request");
var rp = require("request-promise-native");

module.exports = function (RED) {
  const ALL_FLAGS = "PUBLIC, BETA, DIRECT_MESSAGING, FAVORITES, USERSPACEATTRIBUTES, MENTION, TYPED_ANNOTATIONS, SPACE_TEMPLATE, SPACE_MEMBERS, EXPERIMENTAL";
  const BETA_EXP_FLAGS = "PUBLIC,BETA,EXPERIMENTAL";
  
  //
  //  Generic graphQL Node
  //
  function wwsGraphQLNode(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    function _isInitialized() {
      var initialized = false;
      if (tokenFsm.getAccessToken()) {
        node.status({fill: "green", shape: "dot", text: "token available"});
        initialized = true;
      } else {
        node.status({fill: "grey", shape: "dot", text: "uninitialized token"});
      }
      return initialized;
    };
      
    //Check for token on start up
    const tokenFsm = node.application.getStateMachine();
    if (!tokenFsm) {
      console.log("No Account Info");
      node.status({fill:"red", shape:"dot", text:"Please configure your account information first!"});
      node.error("Please configure your account information first!");
      return;
    }
    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        };
      }, 2000);
    };

    this.on("input", (msg) => {
      if (!msg.payload) {
        console.log("No Payload Info");
        node.status({fill:"red", shape:"dot", text:"No Payload"});
        node.error("Missing required input in msg object: payload");
        return;
      }


      var accessToken = this.application.verifyAccessToken(tokenFsm.getAccessToken(), this);
      var bearerToken = msg.wwsToken || accessToken.token.access_token;
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
      setTimeout(() => {_isInitialized(); }, 2000);
    });
  }


  //
  //  Retrieve information about a list of people
  //
  function wwsGetPersons(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;
    var async = require("async");
    var asyncTasks = [];
        
    function _dummyCallback(err, item) {
      console.log('DUMMY CALLBACK ' + item);
    }

    function _beforeSend(theMsg) {
        console.log('_beforeSend: need to process ' + asyncTasks.length + ' async tasks...');
        //
        //  This is where the MAGIC of Async happens
        //
        if (asyncTasks.length > 0) {
            async.parallel(asyncTasks, function(err, results) {
                                            //
                                            // All tasks are done now
                                            //  We can return
                                            //
                                            console.log("_beforeSend : ready to send final information....");
                                            node.send(theMsg);
                                        }
            );                  
        } else {
            //
            //  Nothing asynchronous to do
            //  We can return immediatealy
            //
            node.send(theMsg);
        }
    }
    function _getPersonDetails(token, host, person, type, fullMsg, callback) {
      if (type !== "byMail") return;
      var query = 'query getPersonByMail {person(email: "' + person + '") {displayName extId email photoUrl customerId ibmUniqueID created updated presence id}}';
      //
      //  Perform the operation
      //
      wwsGraphQL(token, host, query, null, null, BETA_EXP_FLAGS)
      .then((res) => {
        if (res.errors) {
          fullMsg.payload = res.errors;
          console.log('errors getting ' + person);
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: 'errors getting ' + person});
          node.error('errors getting ' + person, fullMsg);
          return;
        } else {
          //
          //  Successfull Result !
          //
          fullMsg.payload.people.push(res.data);
          console.log('Person ' + person + ' succesfully retrieved !');
          console.log(JSON.stringify(res.data));
          node.status({fill: "green", shape: "dot", text: 'Person ' + person + ' succesfully retrieved !'});
          callback(null, person);
        }
      }).catch((err) => {
        console.log("Errors while retrieveing " + person, err);
        node.status({fill: "red", shape: "ring", text: "Errors while retrieveing " + person});
        node.error("Errors while retrieveing " + person, err);
        return;
      });
    }

    function _isInitialized() {
      var initialized = false;
      if (tokenFsm.getAccessToken()) {
        node.status({fill: "green", shape: "dot", text: "token available"});
        initialized = true;
      } else {
        node.status({fill: "grey", shape: "dot", text: "uninitialized token"});
      }
      return initialized;
    };
      
    //Check for token on start up
    const tokenFsm = node.application.getStateMachine();
    if (!tokenFsm) {
      console.log("No Account Info");
      node.status({fill:"red", shape:"dot", text:"Please configure your account information first!"});
      node.error("Please configure your account information first!");
      return;
    }
    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        };
      }, 2000);
    };

    this.on("input", (msg) => {
      //
      //  Get People
      //
      var people = null;
      if ((config.wwsPersonList.trim() === '') && 
          ((msg.wwsPersonList === undefined) || (msg.wwsPersonList === null))) {
              console.log("No Person to retrieve ");
              node.status({fill:"red", shape:"dot", text:"No Person to retrieve "});
              node.error("No Person to retrieve ");
              return;
      } else {
        if (config.wwsPersonList.trim() !== '') {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          let theList = config.wwsPersonList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            theList[i] = theList[i].trim();
          }
          people = theList;
        } else {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          let theList = msg.wwsPersonList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            theList[i] = theList[i].trim();
          }
          people = theList;
        }
      }

      var accessToken = this.application.verifyAccessToken(tokenFsm.getAccessToken(), this);
      var bearerToken = msg.wwsToken || accessToken.token.access_token;
      var host = this.application.api;

      //
      //  We asynchronously execute all the things
      //
      msg.payload = {};
      msg.payload.people = [];
      for (let k=0; k < people.length; k++) {
        asyncTasks.push(function(_dummyCallback) {
          _getPersonDetails(bearerToken, host, people[k].trim(), config.PeopleOperation, msg, _dummyCallback);
        });
      }
      _beforeSend(msg);
      setTimeout(() => {_isInitialized(); }, 2000);
    });
  }


  //
  //  Add/Remove Members from a space
  //
  function wwsAddRemoveMembers(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    function _isInitialized() {
      var initialized = false;
      if (tokenFsm.getAccessToken()) {
        node.status({fill: "green", shape: "dot", text: "token available"});
        initialized = true;
      } else {
        node.status({fill: "grey", shape: "dot", text: "uninitialized token"});
      }
      return initialized;
    };
      
    //Check for token on start up
    const tokenFsm = node.application.getStateMachine();
    if (!tokenFsm) {
      console.log("No Account Info");
      node.status({fill:"red", shape:"dot", text:"Please configure your account information first!"});
      node.error("Please configure your account information first!");
      return;
    }
    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        };
      }, 2000);
    };

    this.on("input", (msg) => {
      //
      //  get Space Id
      //
      var spaceId = '';
      if ((config.wwsSpaceId === '') && 
          ((msg.wwsSpaceId === undefined) || (msg.wwsSpaceId === ''))) {
        //
        //  There is an issue
        //
        console.log("Missing spaceId Information");
        node.status({fill:"red", shape:"dot", text:"Missing spaceID"});
        node.error('Missing spaceID', msg);
        return;
      }
      if (config.wwsSpaceId !== '') {
        spaceId = config.wwsSpaceId;
      } else {
        spaceId = msg.wwsSpaceId;
      }
      //
      //  Get Members
      //
      var members = null;
      if ((config.wwsMemberList.trim() === '') && 
          ((msg.wwsMemberList === undefined) || (msg.wwsMemberList === null))) {
        //
        //  No Members to be added  
        //  I am fine with this
        //
      } else {
        if (config.wwsMemberList.trim() !== '') {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          let theList = config.wwsMemberList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            theList[i] = theList[i].trim();
          }
          members = theList;
        } else {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          let theList = msg.wwsMemberList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            theList[i] = theList[i].trim();
          }
          members = theList;
        }
      }


      var accessToken = this.application.verifyAccessToken(tokenFsm.getAccessToken(), this);
      var bearerToken = msg.wwsToken || accessToken.token.access_token;
      var host = this.application.api;

      var mutation = _AddOrRemoveMutation(spaceId, members, config.ARoperation);
      //
      //  Perform the operation
      //
      wwsGraphQL(bearerToken, host, mutation, null, null, BETA_EXP_FLAGS)
      .then((res) => {
        if (res.errors) {
          msg.payload = res.errors;
          console.log('errors adding/removing Members');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "errors adding/removing Members"});
          node.error("errors adding/removing Members", msg);
          return;
        } else {
          //
          //  Successfull Result !
          //
          msg.payload = res.data;
          console.log('Members operation ' + config.ARoperation + ' succesfully completed !');
          console.log(JSON.stringify(res.data));
          node.status({fill: "green", shape: "dot", text: 'Members operation ' + config.ARoperation + ' succesfully completed !'});
          node.send(msg);
        }
      }).catch((err) => {
        console.log("Errors while adding/removing Members", err);
        node.status({fill: "red", shape: "ring", text: "Errors while adding/removing Members..."});
        node.error("Errors while adding/removing Members...", err);
        return;
      });
      setTimeout(() => {_isInitialized(); }, 2000);
    });
  }

  //
  //  This node gets the Annotation referred to by a message containing the "Action-Selected" actionId
  //
  function wwsValidateActions(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    function _isInitialized() {
      var initialized = false;
      if (tokenFsm.getAccessToken()) {
        node.status({fill: "green", shape: "dot", text: "token available"});
        initialized = true;
      } else {
        node.status({fill: "grey", shape: "dot", text: "uninitialized token"});
      }
      return initialized;
    };
    //Check for token on start up
    const tokenFsm = node.application.getStateMachine();
    if (!tokenFsm) {
      console.log("No Account Info");
      node.status({fill:"red", shape:"dot", text:"No Account Info"});
      node.error("Please configure your account information first!");
    }
    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        };
      }, 2000);
    };

    this.on("input", (msg) => {
      var referralMessageId;
      var actionId;
      var actionList;
      var parExp = /(.*?)\s\((.*?)\)/;

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
      //  Check that the incoming actionId is in the list
      //
      var selectedRule = -1;
      for (let i=0; i < actionList.length; i++) {
        var theAction = actionList[i].trim();
        if (theAction.match(parExp)) {
          //
          //  There is the LENS in parenthesis. So we get the part outside parenthseis
          //
          theAction = theAction.match(parExp)[1].trim();
        }
        if (matchRuleShort(actionId, theAction)) {
          selectedRule = i;
          break;
        }
      }
      if (selectedRule === -1) {
        console.log('Selected Rule is : ' + selectedRule + ' (over ' + actionList.length + ') : OTHERWISE');
        //
        //  Build an output array of messages where all the messages are NULL except the Last one
        //
        console.log('ActionId ' + actionId + ' does not match input ActionsList');
        var outArray = [];
        for (let i=0; i < actionList.length; i++) {
          outArray.push(null);
        }
        outArray.push(msg);
        node.status({fill:"yellow", shape:"dot", text:"Action " + actionId + " not found -> Going OTHERWISE"});
        node.send(outArray);
        return;
      }

      console.log('Selected Rule is : ' + selectedRule + ' (over ' + actionList.length + ') : ' + actionList[selectedRule].trim());
      console.log('processing .....');
      //
      //  At this point, we know that we are trying to match an ActionId which is in the list
      //
      //  If the ActionId does not correspond to a LENS (intent), we do not have to do much....
      //
      var theAction = actionList[selectedRule].trim();
      if (theAction.match(parExp) === null) {
          //
          //  Build the output Array (as the node has multiple outputs)
          //  all the outputs will be initialized to NULL
          //
          var outArray = [];
          for (let i=0; i <= actionList.length; i++) {
            outArray.push(null);
          }
          //
          //  the array item corresponding to the selectedRule is filled with the INCOMING MESSAGE
          //
          outArray[selectedRule] = msg;
          //  
          //  Sends the output array
          //
          node.status({fill:"green", shape:"dot", text:"No Lens for Action " + actionId});
          node.send(outArray);  
          return;      
      }
      var lens = theAction.match(parExp)[2].trim();
      node.status({fill: "blue", shape: "dot", text: "Ready to get lens " + lens});
      //
      //  If the ActionId has a lens, then we need to get the one annotation from the referralMsessageId which
      //  corresponds to the Actios ID.
      //  So we are ready to build the graphQL query to retrieve the annotations 
      //
      var accessToken = this.application.verifyAccessToken(tokenFsm.getAccessToken(), this);
      var bearerToken = msg.wwsToken || accessToken.token.access_token;
      var host = this.application.api;
      var query = 'query getAnnotations { message(id: "' + referralMessageId + '"){annotations}}';
      //
      //  Retrieve the annotations for the given Message
      //
      wwsGraphQL(bearerToken, host, query, null, null, "PUBLIC")
      .then((res) => {
        if (res.errors) {
          //
          //  Should NOT BE...
          //
          msg.payload = res.errors;
          console.log('errors from query');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "Errors from query"});
          node.error('Missing ActionsList', msg);
        } else {
          //
          //  Ok, we got the array of annotations...
          //
          console.log('Success from graphQL query : Annotations retrieved');
          console.log(JSON.stringify(res.data));
          node.status({fill: "green", shape: "dot", text: "Annotations retrieved..."});
          //
          //  Now we have the annotations. Check to find the one that is "message-focus" and corresponds to the lens=ActionId
          //
          var found = false;
          if (res.data.message !== null) {
            for (let i=0; i < res.data.message.annotations.length; i++) {
              let intent = JSON.parse(res.data.message.annotations[i]);
              if ((intent.type === "message-focus") && (intent.lens === lens)) {
                msg.payload = intent;
                found = true;
                break;
              }
            }
          }
          if (found) {
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
            node.status({fill: "green", shape: "dot", text: "Lens " + lens + " returned"});
            node.send(outArray);
          } else {
            //
            //  Strange situation (no annotations or the LENS was not found....)
            //
            console.log("Error while dealing with action " + actionId + ' for lens ' + lens);
            node.status({fill: "red", shape: "ring", text: "Error while dealing with action " + actionId + ' for lens ' + lens});
            node.error('Lens ' + lens + ' not found for action ' + actionId, msg);
              }
        }})
      .catch((err) => {
        msg.payload = err;
        console.log("Error while posting GraphQL query to WWS.", err);
        node.status({fill: "red", shape: "ring", text: "Sending query failed..."});
        node.error('Error while posting GraphQL query to WWS.', msg);
      });
      setTimeout(() => {_isInitialized();}, 2000);
    });
  }

  //
  //  Get Template
  //
  function wwsGetTemplate(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    function _isInitialized() {
      var initialized = false;
      if (tokenFsm.getAccessToken()) {
        node.status({fill: "green", shape: "dot", text: "token available"});
        initialized = true;
      } else {
        node.status({fill: "grey", shape: "dot", text: "uninitialized token"});
      }
      return initialized;
    };
      
    //Check for token on start up
    const tokenFsm = node.application.getStateMachine();
    if (!tokenFsm) {
      console.log("No Account Info");
      node.status({fill:"red", shape:"dot", text:"Please configure your account information first!"});
      node.error("Please configure your account information first!");
      return;
    }
    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        };
      }, 2000);
    };

    this.on("input", (msg) => {
      var templateId = '';
      if ((config.wwsTemplateId === '') && 
          ((msg.wwsTemplateId === undefined) || (msg.wwsTemplateId === ''))) {
        //
        //  There is an issue
        //
        console.log("Missing templateID Information");
        node.status({fill:"red", shape:"dot", text:"Missing TemplateID"});
        node.error('Missing TemplateID', msg);
        return;
      }
      if (config.wwsTemplateId !== '') {
        templateId = config.wwsTemplateId;
      } else {
        templateId = msg.wwsTemplateId;
      }


      var accessToken = this.application.verifyAccessToken(tokenFsm.getAccessToken(), this);
      var bearerToken = msg.wwsToken || accessToken.token.access_token;
      var host = this.application.api;

      var query = _getTemplateQuery(templateId);
      console.log(query);
      //
      //  Retrieve the space info
      //
      wwsGraphQL(bearerToken, host, query, null, null, BETA_EXP_FLAGS)
      .then((res) => {
        if (res.errors) {
          msg.payload = res.errors;
          console.log('errors from query');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "Errors from query"});
          node.error("Errors from query", msg);
          return;
        } else {
          //
          //  Successfull Result !
          //
          msg.payload = res.data;
          console.log('Success from graphQL query');
          console.log(JSON.stringify(res.data));
          node.status({fill: "green", shape: "dot", text: "graphQL Query success"});
          node.send(msg);
        }
      }).catch((err) => {
        console.log("Error while posting GraphQL query to WWS.", err);
        node.status({fill: "red", shape: "ring", text: "Sending query failed..."});
        node.error("Sending query failed...", err);
        return;
      });
      setTimeout(() => {_isInitialized(); }, 2000);
    });
  }
  

  //
  //  Get Templated Space
  //
  function wwsGetTemplatedSpace(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    function _isInitialized() {
      var initialized = false;
      if (tokenFsm.getAccessToken()) {
        node.status({fill: "green", shape: "dot", text: "token available"});
        initialized = true;
      } else {
        node.status({fill: "grey", shape: "dot", text: "uninitialized token"});
      }
      return initialized;
    };
      
    //Check for token on start up
    const tokenFsm = node.application.getStateMachine();
    if (!tokenFsm) {
      console.log("No Account Info");
      node.status({fill:"red", shape:"dot", text:"Please configure your account information first!"});
      node.error("Please configure your account information first!");
      return;
    }
    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        };
      }, 2000);
    };

    this.on("input", (msg) => {
      var spaceId = '';
      if ((config.wwsSpaceId === '') && 
          ((msg.wwsSpaceId === undefined) || (msg.wwsSpaceId === ''))) {
        //
        //  There is an issue
        //
        console.log("Missing spaceID Information");
        node.status({fill:"red", shape:"dot", text:"Missing SpaceID"});
        node.error('Missing SpaceID', msg);
        return;
      }
      if (config.wwsSpaceId !== '') {
        spaceId = config.wwsSpaceId;
      } else {
        spaceId = msg.wwsSpaceId;
      }


      var accessToken = this.application.verifyAccessToken(tokenFsm.getAccessToken(), this);
      var bearerToken = msg.wwsToken || accessToken.token.access_token;
      var host = this.application.api;

      var query = _getTemplatedSpaceQuery(spaceId);
      console.log(query);
      //
      //  Retrieve the space info
      //
      wwsGraphQL(bearerToken, host, query, null, null, BETA_EXP_FLAGS)
      .then((res) => {
        if (res.errors) {
          msg.payload = res.errors;
          console.log('errors from query');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "Errors from query"});
          node.error("Errors from query", msg);
          return;
        } else {
          //
          //  Successfull Result !
          //
          msg.payload = res.data;
          console.log('Success from graphQL query');
          console.log(JSON.stringify(res.data));
          node.status({fill: "green", shape: "dot", text: "graphQL Query success"});
          //
          //  Now we need to modify the properties in the output to be more descriptive
          //
          msg.payload.space.propertyValueIds = _propertiesIdsToNames(msg.payload.space.propertyValueIds, msg.payload.space.templateInfo.properties.items);
          //
          //  And now we need to add the name of the status
          //
          let statuses = msg.payload.space.templateInfo.spaceStatus.acceptableValues;
          let found = false;
          for (let i = 0; i < statuses.length; i++) {
            if (msg.payload.space.statusValueId === statuses[i].id) {
              found = true;
              msg.payload.space.statusValueName = statuses[i].displayName;
              break;
            }
          }
          if (!found) {
            //
            //  We cannot Set a status that does not exist
            //
            console.log('Status ' + msg.payload.space.statusValueId + ' is unknown!');
            node.status({fill: "red", shape: "dot", text: 'Status ' + msg.payload.space.statusValueId + ' is unknown!'});
            node.error('Status ' + msg.payload.space.statusValueId + ' is unknown!', msg);
            return;
          }
          node.send(msg);
        }
      }).catch((err) => {
        console.log("Error while posting GraphQL query to WWS.", err);
        node.status({fill: "red", shape: "ring", text: "Sending query failed..."});
        node.error("Sending query failed...", err);
        return;
      });
      setTimeout(() => {_isInitialized(); }, 2000);
    });
  }

  //
  //  Update Templated Space
  //
  function wwsUpdateSpace(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    var betweenQuotes = /"([^"\\]*(\\.[^"\\]*)*)"/;
    var parExp = /(\S+)\s*=\s*([^\s"]+|"[^"]*")/;

    function _isInitialized() {
      var initialized = false;
      if (tokenFsm.getAccessToken()) {
        node.status({fill: "green", shape: "dot", text: "token available"});
        initialized = true;
      } else {
        node.status({fill: "grey", shape: "dot", text: "uninitialized token"});
      }
      return initialized;
    };
      
    //Check for token on start up
    const tokenFsm = node.application.getStateMachine();
    if (!tokenFsm) {
      console.log("No Account Info");
      node.status({fill:"red", shape:"dot", text:"Please configure your account information first!"});
      node.error("Please configure your account information first!");
      return;
    }
    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        };
      }, 2000);
    };

    this.on("input", (msg) => {
      //
      //  Get the SpaceID
      //
      var spaceId = '';
      if ((config.wwsSpaceId === '') && 
          ((msg.wwsSpaceId === undefined) || (msg.wwsSpaceId === ''))) {
        //
        //  There is an issue
        //
        console.log("Missing spaceID Information");
        node.status({fill:"red", shape:"dot", text:"Missing SpaceID"});
        node.error('Missing SpaceID', msg);
        return;
      }
      if (config.wwsSpaceId !== '') {
        spaceId = config.wwsSpaceId;
      } else {
        spaceId = msg.wwsSpaceId;
      }
      //
      //  Get the Properties to be modified
      //
      var properties = null;
      if ((config.wwsPropertyList.trim() === '') && 
          ((msg.wwsPropertyList === undefined) || (msg.wwsPropertyList === null))) {
        //
        //  No Properties to be modified! 
        //  I am fine with this
        //
      } else {
        if (config.wwsPropertyList.trim() !== '') {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          var theList = config.wwsPropertyList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            var tt = theList[i].match(parExp);
            if (tt) {
              //
              //  well written name = value   pair
              //
              var theProperty = {};
              theProperty.name = tt[1].trim();

              var tmpS = tt[2].trim();
              if (tmpS.match(betweenQuotes)) {
                theProperty.value = tmpS.match(betweenQuotes)[1];
              } else {
                theProperty.value = tmpS;
              }
              if (properties === null) properties = new Array;
              properties.push(theProperty);
            }
          }
          //
          //  Now we shoudl have processed all the pairs in the config input
          //
        } else {
          //
          //  if inpput comes as "msg.wwsPropertyList" we assume that it is already formatted as an array of name and values
          //
          properties = msg.wwsPropertyList;
        }
      }
      //
      //  Get the new Status for the Space
      //
      var newStatus = null;
      if ((config.wwsNewStatus.trim() === '') && 
          ((msg.wwsNewStatus === undefined) || (msg.wwsNewStatus === ''))) {
        //
        //  Status does not need to be modified 
        //  I am fine with this
        //
      } else {
        if (config.wwsNewStatus.trim() !== '') {
          //
          //  Now we shoudl have processed all the pairs in the config input
          //
          newStatus = config.wwsNewStatus.trim();
        } else {
          //
          //  if inpput comes as "msg.wwsPropertyList" we assume that it is already formatted as an array of name and values
          //
          newStatus = msg.wwsNewStatus.trim();
        }
      }
      //
      //  Get Members
      //
      var members = null;
      if ((config.wwsMemberList.trim() === '') && 
          ((msg.wwsMemberList === undefined) || (msg.wwsMemberList === null))) {
        //
        //  No Members to be added  
        //  I am fine with this
        //
      } else {
        if (config.wwsMemberList.trim() !== '') {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          let theList = config.wwsMemberList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            theList[i] = theList[i].trim();
          }
          members = theList;
        } else {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          let theList = msg.wwsMemberList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            theList[i] = theList[i].trim();
          }
          members = theList;
        }
      }
      //
      //  If there is nothing to be modified, then we exit without doing anything :-)
      //
      if ((newStatus === null) && (properties === null) && (members === null)) {
        //
        //  There is nothing to do
        //
        console.log("Nothing to UPDATE");
        node.status({fill:"yellow", shape:"dot", text:"Nothing to update"});
        node.send(msg);
        return;
      }
      //
      //  Since there is something to do, we need to translate property names, property values (for lists) and statusValues from readable strings to IDs
      //  In order to do this, we first need to get information about the template from which this space has been created
      //
      var accessToken = this.application.verifyAccessToken(tokenFsm.getAccessToken(), this);
      var bearerToken = msg.wwsToken || accessToken.token.access_token;
      var host = this.application.api;
      var query = _getTemplatedSpaceQuery(spaceId);
      wwsGraphQL(bearerToken, host, query, null, null, BETA_EXP_FLAGS)
      .then((res) => {
        if (res.errors) {
          msg.payload = res.errors;
          console.log('errors getting the Template');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "Errors getting the Template"});
          node.error("Errors getting the Template", msg);
          return;
        } else {
          //
          //  Ok, we should have the information about the teamplate.
          //  We need to parse them
          //
          node.status({fill: "green", shape: "dot", text: "Template succesfully retrieved"});
          var templateInfo = res.data.space.templateInfo;
          if (newStatus) {
            //
            //  there is a translation to be made on Status
            //
            let statuses = templateInfo.spaceStatus.acceptableValues;
            let found = false;
            for (let i=0; i < statuses.length; i++) {
              if (newStatus === statuses[i].displayName) {
                found = true;
                newStatus = statuses[i].id;
                break;
              }
            }
            if (!found) {
              //
              //  We cannot Set a status that does not exist
              //
              console.log('Status ' + newStatus + ' is unknown!');
              node.status({fill: "red", shape: "dot", text: 'Status ' + newStatus + ' is unknown!'});
              node.error('Status ' + newStatus + ' is unknown!', msg);
              return;
            }
          }
          let outProps;
          if (properties) {
            //
            //  there is a translation to be done for properties :-)
            //
            outProps = _propertiesNamesToIds(properties, templateInfo.properties.items);
            if (!Array.isArray(outProps)) {
              //
              //  There was an issue in Processing
              //
              console.log(properties[outProps].name + ' is unknown or its value ' + properties[outProps].value);
              node.status({fill: "red", shape: "dot", text: properties[outProps].name + ' is unknown or its value ' + properties[outProps].value});
              node.error(properties[outProps].name + ' is unknown or its value ' + properties[outProps].value, msg);
              return;
            }
          }
          //
          //  Now we can proceed building the mutation to modify the space
          //  Build the mutation
          //
          var mutation = _updateSpaceMutation();
          //
          //  Build the Variables
          //
          var variables = '{"input":';
          variables += '{"id":"' + spaceId + '"';
          //
          //  Add Members if any
          //
          if (members) {
            variables += ', "members":[';
            for (let k=0; k < members.length; k++) {
              variables += '"' + members[k] + '"';
              if (k === (members.length - 1)) {
                variables += ']';
              } else {
                variables += ',';
              }
            }
            variables += ', "memberOperation" : "ADD"';
          }
          //
          //  Add properties if any
          //
          if (outProps) {
            variables += ', "propertyValues":[';
            for (let i=0; i < outProps.length; i++) {
              if (i != 0 ) variables += ",";
              variables += '{"propertyId":"' + outProps[i].id + '", "propertyValueId":"' + outProps[i].valueId + '"}';
            }
            variables += ']';
          }
          //
          //  Add Status if any
          //
          if (newStatus) {
            variables += ', "statusValue" : {"statusValueId" : "' + newStatus + '"}'
          }
          variables += '}}';
          console.log('Updating Space ' + spaceId + ' with these data :');
          console.log(variables);
          console.log('------------------');
          //
          //  Issue the Update Statement
          //
          wwsGraphQL(bearerToken, host, mutation, null, variables, ALL_FLAGS)
          .then((res) => {
            if (res.errors) {
              msg.payload = res.errors;
              console.log('errors updating space ' + spaceId);
              console.log(JSON.stringify(res.errors));
              node.status({fill: "red", shape: "dot", text: 'errors updating space ' + spaceId});
              node.error('errors updating space ' + spaceId, msg);
            } else {
              msg.payload = res.data.updateSpace;
              console.log('Space ' + spaceId + ' UPDATED !!');
              console.log(JSON.stringify(res.data));
              node.status({fill: "green", shape: "dot", text: "Space Updated !"});
              //
              //  Now we need to modify the properties in the output to be more descriptive
              //
              msg.payload.space.propertyValueIds = _propertiesIdsToNames(msg.payload.space.propertyValueIds, templateInfo.properties.items);
              //
              //  And now we need to add the name of the status
              //
              let statuses = templateInfo.spaceStatus.acceptableValues;
              let found = false;
              for (let i=0; i < statuses.length; i++) {
                if (msg.payload.space.statusValueId === statuses[i].id) {
                  found = true;
                  msg.payload.space.statusValueName = statuses[i].displayName;
                  break;
                }
              }
              if (!found) {
                //
                //  We cannot Set a status that does not exist
                //
                console.log('Status ' + msg.payload.space.statusValueId + ' is unknown!');
                node.status({fill: "red", shape: "dot", text: 'Status ' + msg.payload.space.statusValueId + ' is unknown!'});
                node.error('Status ' + msg.payload.space.statusValueId + ' is unknown!', msg);
                return;
              }
              node.send(msg);
            }
          }).catch((err) => {
            console.log("Error updating space.", err);
            node.status({fill: "red", shape: "ring", text: "Error updating space..."});
            node.error("Error updating space.", err);
          });
        }
      }).catch((err) => {
        console.log("Error while getting templatedSpace.", err);
        node.status({fill: "red", shape: "ring", text: "Error while getting templatedSpace..."});
        node.error("Error while getting templatedSpace.", err);
        return;
      });
      setTimeout(() => {_isInitialized(); }, 2000);
    });
  }


  //
  //  Create Space from Template
  //
  function wwsCreateSpaceFromTemplate(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    var betweenQuotes = /"([^"\\]*(\\.[^"\\]*)*)"/;
    var parExp = /(\S+)\s*=\s*([^\s"]+|"[^"]*")/;

    function _isInitialized() {
      var initialized = false;
      if (tokenFsm.getAccessToken()) {
        node.status({fill: "green", shape: "dot", text: "token available"});
        initialized = true;
      } else {
        node.status({fill: "grey", shape: "dot", text: "uninitialized token"});
      }
      return initialized;
    };
      
    //Check for token on start up
    const tokenFsm = node.application.getStateMachine();
    if (!tokenFsm) {
      console.log("No Account Info");
      node.status({fill:"red", shape:"dot", text:"Please configure your account information first!"});
      node.error("Please configure your account information first!");
      return;
    }
    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        };
      }, 2000);
    };

    this.on("input", (msg) => {
      //
      //  Get the templateID
      //
      var templateId = '';
      if ((config.wwsTemplateId === '') && 
          ((msg.wwsTemplateId === undefined) || (msg.wwsTemplateId === ''))) {
        //
        //  There is an issue
        //
        console.log("Missing templateID Information");
        node.status({fill:"red", shape:"dot", text:"Missing templateID"});
        node.error('Missing templateID', msg);
        return;
      }
      if (config.wwsTemplateId !== '') {
        templateId = config.wwsTemplateId;
      } else {
        templateId = msg.wwsTemplateId;
      }
      //
      //  Get the new space Name
      //
      var spaceName = '';
      if ((config.wwsSpaceName === '') && 
          ((msg.wwsSpaceName === undefined) || (msg.wwsSpaceName === ''))) {
        //
        //  There is an issue
        //
        console.log("Missing Space Name Information");
        node.status({fill:"red", shape:"dot", text:"Missing Space Name"});
        node.error('Missing Space Name', msg);
        return;
      }
      if (config.wwsSpaceName !== '') {
        spaceName = config.wwsSpaceName;
      } else {
        spaceName = msg.wwsSpaceName;
      }
      //
      //  Get the Properties to be modified
      //
      var properties = null;
      if ((config.wwsPropertyList.trim() === '') && 
          ((msg.wwsPropertyList === undefined) || (msg.wwsPropertyList === null))) {
        //
        //  No Properties to be modified! 
        //  I am fine with this
        //
      } else {
        if (config.wwsPropertyList.trim() !== '') {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          let theList = config.wwsPropertyList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            let tt = theList[i].match(parExp);
            if (tt) {
              //
              //  well written name = value   pair
              //
              let theProperty = {};
              theProperty.name = tt[1].trim();

              let tmpS = tt[2].trim();
              if (tmpS.match(betweenQuotes)) {
                theProperty.value = tmpS.match(betweenQuotes)[1];
              } else {
                theProperty.value = tmpS;
              }
              if (properties === null) properties = new Array;
              properties.push(theProperty);
            }
          }
          //
          //  Now we shoudl have processed all the pairs in the config input
          //
        } else {
          //
          //  if inpput comes as "msg.wwsPropertyList" we assume that it is already formatted as an array of name and values
          //
          properties = msg.wwsPropertyList;
        }
      }
      //
      //  Get Members
      //
      var members = null;
      if ((config.wwsMemberList.trim() === '') && 
          ((msg.wwsMemberList === undefined) || (msg.wwsMemberList === null))) {
        //
        //  No Members to be added  
        //  I am fine with this
        //
      } else {
        if (config.wwsMemberList.trim() !== '') {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          let theList = config.wwsMemberList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            theList[i] = theList[i].trim();
          }
          members = theList;
        } else {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          let theList = msg.wwsMemberList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            theList[i] = theList[i].trim();
          }
          members = theList;
        }
      }
      //
      //  Since there is something to do, we need to tranlsta property names, property values (fooor lists) and statusValues from readable strings to IDs
      //  In order to do this, we first need to get information about the template
      //
      var accessToken = this.application.verifyAccessToken(tokenFsm.getAccessToken(), this);
      var bearerToken = msg.wwsToken || accessToken.token.access_token;
      var host = this.application.api;
      //
      //  The Mutation is independent if there are Properties or not (this will change the way in which the "variables" will be defined)
      //  So we can define the mutation upfront
      //
      var mutation = _createSpaceMutation();
      //
      //  start build the variables
      //
      var variables = '{"input":';
      variables += '{"templateId":"' + templateId + '",';
      variables += '"title":"' + spaceName + '",';
      variables += '"visibility":"PRIVATE"';
      //
      //  Add Members if any
      //
      if (members) {
        variables += ', "members":[';
        for (let k=0; k < members.length; k++) {
          variables += '"' + members[k] + '"';
          if (k === (members.length - 1)) {
            variables += ']';
          } else {
            variables += ',';
          }
        }
        //variables += ', "memberOperation" : "ADD"';
      }
      //
      //  At this point, we need to get the Template
      //
      let query = _getTemplateQuery(templateId);
      //
      //  Retrieve the template info
      //
      wwsGraphQL(bearerToken, host, query, null, null, BETA_EXP_FLAGS)
      .then((res) => {
        if (res.errors) {
          msg.payload = res.errors;
          console.log("Errors retrieving TemplateId " + templateId);
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "Errors retrieving TemplateId " + templateId});
          node.error("Errors Retrieving TemplateId " + templateId, msg);
          return;
        } else {
          //
          //  Successfull Result ! HABEMUS TEMPLATE
          //
          let templateProperties = res.data.spaceTemplate.properties.items;
          let statuses = res.data.spaceTemplate.spaceStatus.acceptableValues;
          //
          //  Now we have to validate the properties
          //
          if (properties) {
            let outProperties = _propertiesNamesToIds(properties, templateProperties);
            if (Array.isArray(outProperties)) {
              //
              //  We have the correspondance between Textual representation and IDs
              //  We can build the variables"
              //
              variables += ', "propertyValues":[';
              for (let i=0; i < outProperties.length; i++) {
                if (i != 0 ) variables += ",";
                variables += '{"propertyId":"' + outProperties[i].id + '", "propertyValueId":"' + outProperties[i].valueId + '"}';
              }
              variables += ']';
            } else {
              //
              //  There is an error somewhere. A property or its value is not allowed
              //
              msg.payload = null;
              console.log('Property ' + properties[outProperties].name + ' or its value ' + properties[outProperties].value + ' is not allowed');
              node.status({fill: "red", shape: "dot", text: 'Property ' + properties[outProperties].name + ' or its value ' + properties[outProperties].value + ' is not allowed'});
              node.error('Property ' + properties[outProperties].name + ' or its value ' + properties[outProperties].value + ' is not allowed', msg);
              return;
            }
          } else {
            //
            //  No Properties
            //  We can build a very simple "variables"
            //
          }
          variables += '}}';
          console.log('Creating Space ' + spaceName + ' from template ' + templateId + ' with these data :');
          console.log(variables);
          console.log('------------------');
          //
          //  Issue the create Statement
          //
          wwsGraphQL(bearerToken, host, mutation, null, variables, BETA_EXP_FLAGS)
          .then((res) => {
            if (res.errors) {
              msg.payload = res.errors;
              console.log('errors creating space ' + spaceName + ' from template ' + templateId);
              console.log(JSON.stringify(res, ' ', 2));
              node.status({fill: "red", shape: "dot", text: 'errors creating space ' + spaceName + ' from template ' + templateId});
              node.error('errors creating space ' + spaceName + ' from template ' + templateId, msg);
            } else {
              msg.payload = res.data.createSpace;
              console.log('Space ' + spaceName + ' CREATED !!');
              console.log(JSON.stringify(res.data));
              node.status({fill: "green", shape: "dot", text: "Space Created !"});
              //
              //  Now we need to modify the properties in the output to be more descriptive
              //
              msg.payload.space.propertyValueIds = _propertiesIdsToNames(msg.payload.space.propertyValueIds, templateProperties);
              //
              //  And now we need to add the name of the status
              //
              let found = false;
              for (let i=0; i < statuses.length; i++) {
                if (msg.payload.space.statusValueId === statuses[i].id) {
                  found = true;
                  msg.payload.space.statusValueName = statuses[i].displayName;
                  break;
                }
              }
              if (!found) {
                //
                //  We cannot Set a status that does not exist
                //
                console.log('Status ' + msg.payload.space.statusValueId + ' is unknown!');
                node.status({fill: "red", shape: "dot", text: 'Status ' + msg.payload.space.statusValueId + ' is unknown!'});
                node.error('Status ' + msg.payload.space.statusValueId + ' is unknown!', msg);
                return;
              }
              node.send(msg);
            }
          }).catch((err) => {
            console.log("Error creating space " + spaceName + ' from template ' + templateId, err);
            node.status({fill: "red", shape: "ring", text: "Error creating space " + spaceName + ' from template ' + templateId});
            node.error("Error creating space " + spaceName + ' from template ' + templateId, err);
          });
        }
      }).catch((err) => {
        console.log("Error while posting GraphQL query to WWS.", err);
        node.status({fill: "red", shape: "ring", text: "Sending query failed..."});
        node.error("Sending query failed...", err);
        return;
      });
      setTimeout(() => {_isInitialized(); }, 2000);       
    });
  }
  
  
  RED.nodes.registerType("wws-graphql", wwsGraphQLNode);
  
  RED.nodes.registerType("wws-addRemoveMembers", wwsAddRemoveMembers);
  
  RED.nodes.registerType("wws-getPeople", wwsGetPersons);

  RED.nodes.registerType("wws-validateActions", wwsValidateActions);

  RED.nodes.registerType("wws-getTemplate", wwsGetTemplate);

  RED.nodes.registerType("wws-getTemplatedSpace", wwsGetTemplatedSpace);

  RED.nodes.registerType("wws-updateTemplatedSpace", wwsUpdateSpace);

  RED.nodes.registerType("wws-createSpaceFromTemplate", wwsCreateSpaceFromTemplate);

  //
  //  Helper functions
  //
  function wwsGraphQL(accessToken, host, query, operationName, variables, viewType) {
    var uri = host + "/graphql";
    /*
    if (operationName) {
      uri += "?operationName=" + operationName;
    }
    if (variables) {
      uri += (uri.includes("?") ? "&" : "?") + "variables=" + variables;
    }
    */
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
    if (variables) options.body.variables = variables;
    if (operationName) options.body.operationName = operationName;
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

  function _propertiesNamesToIds(properties, templates) {
    var outProperties = [];
    for (let i=0; i < properties.length; i++) {
      let found = false;
      let newProp = {};
      for (let j=0; j < templates.length; j++) {
        if (properties[i].name === templates[j].displayName) {
          found = true;
          newProp.id = templates[j].id;
          newProp.type = templates[j].type;
          newProp.displayName = templates[j].displayName;
          if (templates[j].type === "LIST") {
            //
            //  For LISTSs, the value becomes an ID also
            //
            found = false;
            for (let k=0; k < templates[j].acceptableValues.length; k++) {
              if (properties[i].value === templates[j].acceptableValues[k].displayName) {
                found = true;
                newProp.valueId = templates[j].acceptableValues[k].id;
                newProp.valueDisplayName = properties[i].value;
                break;
              }
            }
          } else {
            if (templates[j].type === "BOOLEAN") {
              //
              //  Booleans can only be TRUE or FALSe, right ?
              //
              if ((properties[i].value.toLowerCase() === "true") || (properties[i].value.toLowerCase() === "false")) {
                newProp.valueId = properties[i].value.toUpperCase();
                newProp.valueDisplayName = newProp.valueId;
              } else {
                found = false;
              }
            } else {
              //
              //  Text Attributes. NOTHING to Change
              //
              newProp.valueId = properties[i].value;
              newProp.valueDisplayName = properties[i].value;
            }
          }
          //
          //  We have found... So we can exit the inner loop
          //
          break;
        }
      }
      //
      //  We have done the parsing
      //
      if (!found) {
        //
        //  There was something wrong. Either the name of the property is unknown or the property value is not valid
        //  returning the index of the offending property
        //
        return i;
      } else {
        outProperties.push(newProp);
      }
    }
    return outProperties;
  }

  function _propertiesIdsToNames(properties, templates) {
    var outProperties = [];
    for (let i=0; i < properties.length; i++) {
      let found = false;
      let newProp = {};
      for (let j=0; j < templates.length; j++) {
        if (properties[i].propertyId === templates[j].id) {
          found = true;
          newProp.id = templates[j].id;
          newProp.type = templates[j].type;
          newProp.displayName = templates[j].displayName;
          if (templates[j].type === "LIST") {
            //
            //  For LISTSs, the value becomes an ID also
            //
            found = false;
            for (let k=0; k < templates[j].acceptableValues.length; k++) {
              if (properties[i].propertyValueId === templates[j].acceptableValues[k].id) {
                found = true;
                newProp.valueId = templates[j].acceptableValues[k].id;
                newProp.valueDisplayName = templates[j].acceptableValues[k].displayName;
                break;
              }
            }
          } else {
            if (templates[j].type === "BOOLEAN") {
              //
              //  Booleans can only be TRUE or FALSe, right ?
              //
              if ((properties[i].propertyValueId.toLowerCase() === "true") || (properties[i].propertyValueId.toLowerCase() === "false")) {
                newProp.valueId = properties[i].propertyValueId.toUpperCase();
                newProp.valueDisplayName = newProp.valueId;
              } else {
                found = false;
              }
            } else {
              //
              //  Text Attributes. NOTHING to Change
              //
              newProp.valueId = properties[i].propertyValueId;
              newProp.valueDisplayName = properties[i].propertyValueId;
            }
          }
          //
          //  We have found... So we can exit the inner loop
          //
          break;
        }
      }
      //
      //  We have done the parsing
      //
      if (!found) {
        //
        //  There was something wrong. Either the name of the property is unknown or the property value is not valid
        //  returning the index of the offending property
        //
        return i;
      } else {
        outProperties.push(newProp);
      }
    }
    return outProperties;
  }

  function _AddOrRemoveMutation(spaceId, members, operation) {
    var mutation = 'mutation updateSpaceAddMembers{updateSpace(input: { id: "' + spaceId + '\",  members: [';
    for (let k=0; k < members.length; k++) {
      mutation += '"' + members[k] + '"';
      if (k === (members.length - 1)) {
        mutation += ']';
      } else {
        mutation += ',';
      }
    }
    mutation += ', memberOperation: ' + operation + '}){memberIdsChanged space {id title membersUpdated members {items {id displayName email customerId presence photoUrl}}}}}';
    console.log(mutation);
    return mutation;
  }

  function _createSpaceMutation() {
    var mutation = 'mutation createSpace($input: CreateSpaceInput!) {createSpace(input: $input) {space {';
    mutation += 'id title description visibility';
    mutation += ' team {id displayName teamSettings {appApprovalEnabled}}';
    mutation += ' members {pageInfo {startCursor endCursor hasNextPage hasPreviousPage} items {id displayName email customerId presence photoUrl}}';
    mutation += ' propertyValueIds {propertyId propertyValueId} statusValueId';
    mutation += ' created createdBy {id displayName email customerId presence photoUrl}';
    mutation += ' updated updatedBy {id displayName email customerId presence photoUrl}';
    mutation += ' conversation {id messages(first: 1) {items {id content contentType annotations reactions {reaction count viewerHasReacted}}}}';
    mutation += ' activeMeeting { meetingNumber password}';
    mutation += '}}}';
    console.log(mutation);
    return mutation;
  }
  function _updateSpaceMutation() {
    var mutation = 'mutation updateSpace($input: UpdateSpaceInput!) {updateSpace(input: $input) {space {';
    mutation += 'id title description visibility';
    mutation += ' team {id displayName teamSettings {appApprovalEnabled}}';
    mutation += ' members {pageInfo {startCursor endCursor hasNextPage hasPreviousPage} items {id displayName email customerId presence photoUrl}}';
    mutation += ' propertyValueIds {propertyId propertyValueId} statusValueId';
    mutation += ' created createdBy {id displayName email customerId presence photoUrl}';
    mutation += ' updated updatedBy {id displayName email customerId presence photoUrl}';
    mutation += ' conversation {id messages(first: 1) {items {id content contentType annotations reactions {reaction count viewerHasReacted}}}}';
    mutation += ' activeMeeting { meetingNumber password}';
    mutation += '}}}';
    console.log(mutation);
    return mutation;
  }

  function _getTemplateQuery(templateId) {
    var query = 'query spaceTemplate { spaceTemplate(id: "' + templateId + '") {';
    query += 'id name description teamId labelIds offeringCollaborationType';
    query += ' spaceStatus {acceptableValues {id displayName} defaultValue} requiredApps{items {id}} properties {items {id type displayName ';
    query += '... on SpaceListProperty {defaultValue acceptableValues {id displayName }} ... on SpaceTextProperty {defaultValue} ... on SpaceBooleanProperty {defaultStringValue}}}';
    query += ' created createdBy {id displayName email customerId presence photoUrl} updated updatedBy {id displayName email customerId presence photoUrl}';
    query += '}}';
    console.log(query);
    return query;
  }

  
  function _getTemplatedSpaceQuery(spaceId) {
    var query = 'query getTemplatedSpace { space(id: "' + spaceId + '") {';
    query += 'id title description visibility';
    //
    //  Template Infos for the space 
    //
    query += ' templateInfo {id name description labelIds';
    query += ' spaceStatus {acceptableValues {id displayName} defaultValue} requiredApps{items {id}} properties {items {id type displayName ';
    query += '... on SpaceListProperty {defaultValue acceptableValues {id displayName }} ... on SpaceTextProperty {defaultValue} ... on SpaceBooleanProperty {defaultStringValue}}}';
    query += ' created createdBy {id displayName email customerId presence photoUrl} updated updatedBy {id displayName email customerId presence photoUrl}}';

    query += ' team {id displayName teamSettings {appApprovalEnabled}}';
    query += ' members {pageInfo {startCursor endCursor hasNextPage hasPreviousPage} items {id displayName email customerId presence photoUrl}}';
    query += ' propertyValueIds {propertyId propertyValueId} statusValueId';
    query += ' created createdBy {id displayName email customerId presence photoUrl}';
    query += ' updated updatedBy {id displayName email customerId presence photoUrl}';
    query += ' conversation {id messages(first: 1) {items {id content contentType annotations reactions {reaction count viewerHasReacted}}}}';
    query += ' activeMeeting {meetingNumber password}';
    query += ' }}}';
    console.log(query);
    return query;
  }


  /*

  Mutation

  mutation updateSpace ($input:  UpdateSpaceInput!) {updateSpace(input: $input) {space {id title description team {id displayName teamSettings {appApprovalEnabled} } allowGuests visibility modifyMember modifyApp modifySpaceSetting templateId propertyValueIds { propertyId propertyValueId } statusValueId type userSpaceState { unread markedImportant predictedImportant important lastSpaceReadDate } created updated createdBy { id displayName email customerId presence photoUrl } activeMeeting { meetingNumber password }}}}"
variables 

"{"input":{"id":"5b101230e4b09834e0e434d7","propertyValues":[{"propertyId":"acdd0cba-c260-43c1-b77d-0d13526ca1ad","propertyValueId":"TRUE"},{"propertyId":"d2708223-02ca-4a28-b03b-4a9088fc589b","propertyValueId":"due"},{"propertyId":"e1b35006-2c50-4cc6-aab8-a3d1155db4c2","propertyValueId":"FALSE"},{"propertyId":"6409ec4c-1cbc-4f32-a9d8-e5113baaad46","propertyValueId":"9ad4db4c-3e6d-403e-8519-979f12f58d21"},{"propertyId":"66d8289c-706f-4223-b0b4-7def0a2ebfc9","propertyValueId":"00fddd0d-5aaf-487f-90db-ba98bcee321e"},{"propertyId":"285e5b11-ec29-4e72-b938-5dbaf8923442","propertyValueId":"uno"}]}}"




*/
};