module.exports = function (RED) {
  const ALL_FLAGS = "PUBLIC, BETA, DIRECT_MESSAGING, FAVORITES, USERSPACEATTRIBUTES, MENTION, TYPED_ANNOTATIONS, SPACE_TEMPLATE, SPACE_MEMBERS, EXPERIMENTAL";
  const BETA_EXP_FLAGS = "PUBLIC,BETA,EXPERIMENTAL";

  //
  //  Generic graphQL Node
  //
  function wwsGraphQLNode(config) {
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
      node.error("wwsGraphQLNode: Please configure your Watson Workspace App first!");
      return;
    }
    var graphQL_url = node.application.getApiUrl() + "/graphql";
    //
    //  Now wait for the input to this node
    //
    this.on("input", (msg) => {
      if (!msg.payload) {
        console.log("wwsGraphQLNode: No Payload Info");
        node.status({fill:"red", shape:"dot", text:"No Payload"});
        node.error("wwsGraphQLNode: Missing required input in msg object: payload");
        return;
      }
      
      var viewType = "PUBLIC";
      if (config.wwsBetaFeatures) viewType += ',BETA';
      if (config.wwsExperimentalFeatures) viewType += ',EXPERIMENTAL';

      console.log('wwsGraphQLNode: executing GraphQL statement : ' + msg.payload);
      console.log('wwsGraphQLNode: using the following Flags = ' + viewType);
      node.status({fill:"blue", shape:"dot", text:"executing GraphQL query..."});
      var req = _graphQL_options(msg.wwsToken, graphQL_url, msg.payload, viewType, msg.operationName, msg.variables);
      node.application.wwsRequest(req)
      .then((res) => {
        if (res.errors) {
          //
          //  Query Successfull but with Errors
          //
          msg.wwsQLErrors = res.errors;
          console.log('wwsGraphQLNode: errors found in graphQL statement. Continuing...');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "yellow", shape: "dot", text: "errors found in graphQL statement"});
        } else {
          //
          //  Successfull Result !
          //
          console.log('wwsGraphQLNode: graphQL statement successfully executed');
          node.status({fill: "green", shape: "dot", text: 'graphQL statement successfully executed'});
        }
        msg.payload = res.data;
        node.send(msg);
        //
        //  Reset visual status on success
        //
        setTimeout(() => {node.status({});}, 2000);
      }).catch((err) => {
        console.log("wwsGraphQLNode: Error while posting GraphQL query to WWS." + JSON.stringify(err, " ", 2));
        node.status({fill: "red", shape: "ring", text: "graphQL failed..."});
        node.error("wwsGraphQLNode: Error while posting GraphQL query to WWS", err);
        return;
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
  //
  //  Get Message Details
  //
  function wwsGetMessage(config) {
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
      node.error("wwsGetMessage: Please configure your Watson Workspace App first!");
      return;
    }
    var graphQL_url = node.application.getApiUrl() + "/graphql";
    //
    //  Now wait for the input to this node
    //
    this.on("input", (msg) => {
      //
      //  get Space Id
      //
      var messageId = '';
      if ((config.wwsMessageId === '') && 
          ((msg.wwsMessageId === undefined) || (msg.wwsMessageId === ''))) {
        //
        //  There is an issue
        //
        console.log("wwsGetMessage: Missing messageID Information");
        node.status({fill:"red", shape:"dot", text:"Missing messageID"});
        node.error('wwsGetMessage: Missing messageID', msg);
        return;
      }
      if (config.wwsMessageId !== '') {
        messageId = config.wwsMessageId;
      } else {
        messageId = msg.wwsMessageId;
      }
      //
      //  Prepare the operation
      //
      var query = _getMessageInformation(messageId);
      var req = _graphQL_options(msg.wwsToken, graphQL_url, query, BETA_EXP_FLAGS);
      //
      //  Perform the operation
      //
      node.status({fill:"blue", shape:"dot", text:"Getting message..."});
      node.application.wwsRequest(req)
      .then((res) => {
        if (res.errors) {
          //
          //  Query Successfull but with Errors
          //
          msg.wwsQLErrors = res.errors;
          console.log('wwsGetMessage: errors found in getting Message ' + messageId + '. Continuing...');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "yellow", shape: "dot", text: "Some errors getting Message " + messageId});
        } else {
          //
          //  Successfull Result !
          //
          console.log('wwsGetMessage: Retrieving Message for messageID ' + messageId + ' succesfully completed!');
          node.status({fill: "green", shape: "dot", text: 'message ' + messageId + ' succesfully retrieved!'});
        }
        if (res.data && res.data.message) {
          msg.payload = res.data.message;
          msg.payload.annotations = _parseAnnotations(msg.payload.annotations);
        } else {
          //
          //  Message is VOID
          //
          msg.payload = res.data;
          console.log('wwsGetMessage: Retrieving Message for messageID ' + messageId + ' returned an EMPTY MESSAGE - Returning res.data !!!');
          console.log(JSON.stringify(res.data));
        }
        node.send(msg);
        //
        //  Reset visual status on success
        //
        setTimeout(() => {node.status({});}, 2000);
      }).catch((err) => {
        console.log("wwsGetMessage: errors getting Message " + messageId, err);
        node.status({fill: "red", shape: "ring", text: "errors getting Message " + messageId});
        node.error("wwsGetMessage: errors getting Message " + messageId, err);
        return;
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
  //
  //  Retrieve information about a list of people
  //
  function wwsGetPersons(config) {
    RED.nodes.createNode(this, config);
    var async = require("async");
    var asyncTasks = [];
        
    var _dummyCallback = function(err, item) {
      console.log('wwsGetPersons._dummyCallback : ' + item);
    }

    function _beforeSend(theMsg) {
        console.log('wwsGetPersons._beforeSend: need to process ' + asyncTasks.length + ' async tasks...');
        //
        //  This is where the MAGIC of Async happens
        //
        if (asyncTasks.length > 0) {
            async.parallel(asyncTasks, 
                           function(err, results) {
                              //
                              // All tasks are done now. We can return
                              //
                              console.log("wwsGetPersons._beforeSend : ready to send final information....");
                              node.send(theMsg);
                              //
                              //  Reset visual status on success
                              //
                              setTimeout(() => {node.status({});}, 2000);
                          }
            );                  
        } else {
          //
          //  Nothing asynchronous to do
          //  We can return immediatealy
          //
          node.send(theMsg);
          //
          //  Reset visual status on success
          //
          setTimeout(() => {node.status({});}, 2000);
        }
    }
    function _getPersonDetails(token, graphQL_url, person, type, fullMsg, theCallback) {
      //
      //  Prepare the operation
      //
      var query = _getPersonInformation(type, person);
      var req = _graphQL_options(token, graphQL_url, query, BETA_EXP_FLAGS);
      //
      //  Perform the operation
      //
      node.status({fill:"blue", shape:"dot", text:"Getting details..."});
      node.application.wwsRequest(req)
      .then((res) => {
        if (res.errors) {
          //
          //  Query Successfull but with Errors
          //
          fullMsg.wwsQLErrors = res.errors;
          console.log('wwsGetPersons._getPersonDetails : errors found in getting ' + person + '. Continuing...');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "yellow", shape: "dot", text: 'Some errors in getting ' + person});
        } else {
          //
          //  Successfull Result !
          //
          console.log('wwsGetPersons._getPersonDetails : Person ' + person + ' succesfully retrieved !');
          node.status({fill: "green", shape: "dot", text: 'Person ' + person + ' retrieved !'});
        }
        if (res.data && res.data.me) {
          res.data.person = JSON.parse(JSON.stringify(res.data.me));
          delete res.data.me;
        }
        if (res.data) fullMsg.payload.push(res.data);
        theCallback(null, person);
      }).catch((err) => {
        console.log("wwsGetPersons._getPersonDetails : Errors while retrieveing " + person, err);
        node.status({fill: "red", shape: "ring", text: "Errors while retrieveing " + person});
        node.error("wwsGetPersons: Errors while retrieveing " + person, err);
        return;
      });
    }
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
      node.error("wwsGetPersons: Please configure your Watson Workspace App first!");
      return;
    }
    var graphQL_url = node.application.getApiUrl() + "/graphql";
    //
    //  Now wait for the input to this node
    //
    this.on("input", (msg) => {
      if (config.PeopleOperation === "me") {
        //
        //  We asynchronously execute the call
        //
        msg.payload = [];
        asyncTasks = [];
        asyncTasks.push(function(_dummyCallback) {
          _getPersonDetails(msg.wwsToken, graphQL_url, 'MYSELF', config.PeopleOperation, msg, _dummyCallback);
        });
      } else {
        //
        //  Get People
        //
        let people = null;
        if ((config.wwsPersonList.trim() === '') && 
            ((msg.wwsPersonList === undefined) || (msg.wwsPersonList === null))) {
              console.log("wwsGetPersons : No Person to retrieve ");
              node.status({fill:"red", shape:"dot", text:"No Person to retrieve "});
              node.error("wwsGetPersons: No Person to retrieve ");
              return;
        } else {
          let theList = null;
          if (config.wwsPersonList.trim() !== '') {
            //
            //  List of properties is a comma-separated list of  name=value
            //
            theList = config.wwsPersonList.trim().split(',');
          } else {
            //
            //  List of properties is a comma-separated list of  name=value
            //
            theList = msg.wwsPersonList.trim().split(',');
          }
          for (let i=0; i < theList.length; i++) {
            theList[i] = theList[i].trim();
          }
          people = theList;
        }
        //
        //  We asynchronously execute all the things
        //
        msg.payload = [];
        asyncTasks = [];
        for (let k=0; k < people.length; k++) {
          asyncTasks.push(function(_dummyCallback) {
            _getPersonDetails(msg.wwsToken, graphQL_url, people[k].trim(), config.PeopleOperation, msg, _dummyCallback);
          });
        }
      }
      _beforeSend(msg);
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
  //
  //  Add/Remove Members from a space
  //
  function wwsAddRemoveMembers(config) {
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
      node.error("wwsAddRemoveMembers: Please configure your Watson Workspace App first!");
      return;
    }
    var graphQL_url = node.application.getApiUrl() + "/graphql";
    //
    //  Now wait for the input to this node
    //
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
        console.log("wwsAddRemoveMembers: Missing spaceId Information");
        node.status({fill:"red", shape:"dot", text:"Missing spaceID"});
        node.error('wwsAddRemoveMembers: Missing spaceID', msg);
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
        //  No Members to be added / removed 
        //  I am fine with this
        //
          console.log("wwsAddRemoveMembers: No Members to be added/removed. Exiting");
          node.status({fill:"yellow", shape:"square", text:"No members to be added/removed"});
          node.send(msg);
          return;
      } else {
        let theList = null;
        if (config.wwsMemberList.trim() !== '') {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          theList = config.wwsMemberList.trim().split(',');
        } else {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          theList = msg.wwsMemberList.trim().split(',');
        }
        for (let i=0; i < theList.length; i++) {
          theList[i] = theList[i].trim();
        }
        members = theList;
      }
      //
      //  Prepare the operation
      //
      var mutation = _AddOrRemoveMutation(spaceId, members, config.ARoperation);
      var req = _graphQL_options(msg.wwsToken, graphQL_url, mutation, BETA_EXP_FLAGS);
      //
      //  Perform the operation
      //
      node.status({fill:"blue", shape:"dot", text:"performing operation..."});
      node.application.wwsRequest(req)
      .then((res) => {
        if (res.errors) {
          //
          //  Query Successfull but with Errors
          //
          msg.wwsQLErrors = res.errors;
          console.log('wwsAddRemoveMembers: some errors found in adding/removing Members');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "yellow", shape: "dot", text: "Some errors adding/removing Members"});
        } else {
          //
          //  Successfull Result !
          //
          console.log('wwsAddRemoveMembers: Members operation ' + config.ARoperation + ' succesfully completed !');
          node.status({fill: "green", shape: "dot", text: 'Members operation ' + config.ARoperation + ' succesfully completed !'});
        }
        msg.payload = res.data;
        node.send(msg);
        //
        //  Reset visual status on success
        //
        setTimeout(() => {node.status({});}, 2000);
      }).catch((err) => {
        console.log("wwsAddRemoveMembers: Errors while adding/removing Members", err);
        node.status({fill: "red", shape: "ring", text: "Errors while adding/removing Members..."});
        node.error("wwsAddRemoveMembers: Errors while adding/removing Members...", err);
        return;
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
  //
  //  This node gets the Annotation referred to by a message containing the "Action-Selected" actionId
  //
  function wwsFilterActions(config) {
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
      node.error("wwsFilterActions: Please configure your Watson Workspace App first!");
      return;
    }
    var graphQL_url = node.application.getApiUrl() + "/graphql";
    //
    //  Now wait for the input to this node
    //
    this.on("input", (msg) => {
      var actionId;
      var actionList;
      var referralMessageId;
      var parExp = /(.*?)\s\((.*?)\)/;

      //
      //  Get the incoming action
      //
      if ((config.wwsActionId === '') && 
          ((msg.wwsActionId === undefined) || (msg.wwsActionId === ''))) {
        //
        //  There is an issue
        //
        console.log("wwsFilterActions: Missing actionId Information");
        node.status({fill:"red", shape:"dot", text:"Missing actionId Information"});
        node.error('wwsFilterActions: Missing actionId Information', msg);
        return;
      }
      if (config.wwsActionId !== '') {
        actionId = config.wwsActionId.trim();
      } else {
        actionId = msg.wwsActionId.trim();
      }

      //
      //  Get the list of Actions the node is able to deal with
      //
      if ((config.wwsActionsList === '') && 
          ((msg.wwsActionsList === undefined) || (msg.wwsActionsList === ''))) {
        //
        //  There is an issue
        //
        console.log("wwsFilterActions: Missing ActionsList Information");
        node.status({fill:"red", shape:"dot", text:"Missing ActionsList"});
        node.error('wwsFilterActions: Missing ActionsList', msg);
        return;
      }
      if (config.wwsActionsList !== '') {
        actionList = config.wwsActionsList.split(',');
      } else {
        actionList = msg.wwsActionsList.split(',');
      }

      //
      //  Preparing the attribute which contains the Skeleton for the "createTargetedMessage" Mutation
      //
      if (msg.wwsEvent && msg.wwsEvent.annotationPayload) {
        let payload = JSON.parse(msg.wwsEvent.annotationPayload);
        if (payload.conversationId && payload.targetDialogId && payload.updatedBy) {
          msg.wwsAFMutation = _buildTargetedMessage(payload.conversationId, payload.updatedBy, payload.targetDialogId);
          console.log("wwsFilterActions: CreateTargetedMessage Mutation succesfully built and Returned !");
        } else {
          console.log("wwsFilterActions: CreateTargetedMessage Mutation not built : missing parameters !");
          node.warn("wwsFilterActions: CreateTargetedMessage Mutation not built : missing parameters !");
        }
      } else {
        console.log("wwsFilterActions: CreateTargetedMessage Mutation not built : missing wwsEvent or annotationPayload !");
        node.warn("wwsFilterActions: CreateTargetedMessage Mutation not built : missing wwsEvent or annotationPayload !");
      }
      //
      //  Check if the incoming actionId is in the list
      //
      var selectedRule = -1;
      for (let i=0; i < actionList.length; i++) {
        let theAction = actionList[i].trim();
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
      //
      //  incoming ActionId does not match any Action from the list. We will direct to the OTHERWISE output
      //
      if (selectedRule === -1) {
        console.log('wwsFilterActions: Selected Rule is : ' + selectedRule + ' (over ' + actionList.length + ') --> OTHERWISE');
        console.log('wwsFilterActions: ActionId ' + actionId + ' does not match input ActionsList');
        node.warn('wwsFilterActions: ActionId ' + actionId + ' does not match input ActionsList');
        //
        //  Build an output array of messages where all the messages are NULL except the Last one (OTHERWISE)
        //
        var outArray = [];
        for (let i=0; i < actionList.length; i++) {
          outArray.push(null);
        }
        outArray.push(msg);
        node.status({fill:"yellow", shape:"square", text:"Action " + actionId + " not found -> Going OTHERWISE"});
        node.send(outArray);
        return;
      }
      //
      //  At this point, we know that we are trying to match an ActionId which is in the list
      //
      //  If the ActionId does not correspond to a LENS (intent), we do not have to do much....
      //
      console.log('wwsFilterActions: Selected Rule is : ' + selectedRule + ' (over ' + actionList.length + ') : ' + actionList[selectedRule].trim());
      console.log('wwsFilterActions: processing .....');
      var theAction = actionList[selectedRule].trim();
      if (theAction.match(parExp) === null) {
        console.log('wwsFilterActions: Selected Rule ' + actionList[selectedRule].trim() + ' has NO LENS. Returning....');
        //
        //  Build the output Array (as the node has multiple outputs)
        //  all the outputs will be initialized to NULL
        //
        let outArray2 = [];
        for (let i=0; i <= actionList.length; i++) {
          outArray2.push(null);
        }
        //
        //  the array item corresponding to the selectedRule is filled with the INCOMING MESSAGE
        //
        outArray2[selectedRule] = msg;
        //  
        //  Sends the output array
        //
        node.status({fill:"green", shape:"dot", text:"No Lens for Action " + actionId});
        node.send(outArray2);  
        return;      
      }
      //
      //  If the ActionId has a lens, then we need to get the one annotation (message-focus) which corresponds to the Actios ID.
      //  In order to do this, we need to fetch the message to which the annotation refers to 
      //
      //  Check the presence of the wwsReferralMsgId input
      //  It is only required in this case !!!!
      //
      if ((config.wwsReferralMsgId === '') && 
          ((msg.wwsReferralMsgId === undefined) || (msg.wwsReferralMsgId === ''))) {
        //
        //  There is an issue
        //
        console.log("wwsFilterActions: Missing ReferralMsgId Information");
        node.status({fill:"red", shape:"dot", text:"Missing ReferralMsgId"});
        node.error('wwsFilterActions: Missing ReferralMsgId', msg);
        return;
      }
      if (config.wwsReferralMsgId !== '') {
        referralMessageId = config.wwsReferralMsgId.trim();
      } else {
        referralMessageId = msg.wwsReferralMsgId.trim();
      }
      
      //
      //  Check to find the one that is "message-focus" and corresponds to the lens=ActionId
      //
      var lens = theAction.match(parExp)[2].trim();
      console.log('wwsFilterActions: Selected Rule ' + actionList[selectedRule].trim() + ' has Lens ' + lens);
      node.status({fill: "blue", shape: "dot", text: "Ready to get lens " + lens});
      //
      //  If the ActionId has a lens, then we need to get the one annotation from the referralMsessageId which
      //  corresponds to the Actios ID.
      //  So we are ready to build the graphQL query to retrieve the annotations 
      //
      var query = 'query getAnnotations { message(id: "' + referralMessageId + '"){annotations}}';
      var req = _graphQL_options(msg.wwsToken, graphQL_url, query, "PUBLIC");
      //
      //  Retrieve the annotations for the given Message
      //
      node.status({fill:"blue", shape:"dot", text:"Getting annotations.."});
      node.application.wwsRequest(req)
      .then((res) => {
        if (res.errors) {
          //
          //  Query Successfull but with Errors
          //
          msg.wwsQLErrors = res.errors;
          console.log('wwsFilterActions.getAnnotations: some errors found in query');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "yellow", shape: "dot", text: "Some Errors in getAnnotations query"});
        } else {
          //
          //  Ok, we got the array of annotations...
          //
          console.log('wwsFilterActions: Success from graphQL query : Annotations retrieved');
          node.status({fill: "green", shape: "dot", text: "Annotations retrieved..."});
        }
        //
        //  Now we have the annotations. Check to find the one that is "message-focus" and corresponds to the lens=ActionId
        //
        var found = false;
        if (res.data && res.data.message && res.data.message.annotations) {
          for (let i=0; i < res.data.message.annotations.length; i++) {
            let intent = JSON.parse(res.data.message.annotations[i]);
            if ((intent.type === "message-focus") && (intent.lens === lens)) {
              msg.payload = intent;
              if (msg.payload.payload) msg.payload.payload = __myJSONparse(msg.payload.payload);
              if (msg.payload.context) msg.payload.context = __myJSONparse(msg.payload.context);
              found = true;
              break;
            }
          }
        }
        if (found) {
          console.log('wwsFilterActions: Lens ' + lens + ' found. Returning Message-Focus....');
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
          //
          //  Reset visual status on success
          //
          setTimeout(() => {node.status({});}, 2000);
        } else {
          //
          //  Strange situation (no annotations or the LENS was not found....)
          //
          console.log("wwsFilterActions: Error while dealing with action " + actionId + ' for lens ' + lens);
          node.status({fill: "red", shape: "ring", text: "Error while dealing with action " + actionId + ' for lens ' + lens});
          node.error('wwsFilterActions: Lens ' + lens + ' not found for action ' + actionId, msg);
          return;
        }
      }).catch((err) => {
        msg.payload = err;
        console.log("wwsFilterActions: Error while posting GraphQL query to WWS.", err);
        node.status({fill: "red", shape: "ring", text: "Sending query failed..."});
        node.error('wwsFilterActions: Error while posting GraphQL query to WWS.', msg);
        return;
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
  //
  //  This node gets the Annotation referred to by a message containing the "Action-Selected" actionId
  //
  function wwsFilterAnnotations(config) {
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
      node.error("wwsFilterAnnotations: Please configure your Watson Workspace App first!");
      return;
    }
    var graphQL_url = node.application.getApiUrl() + "/graphql";
    //
    //  Now wait for the input to this node
    //
    this.on("input", (msg) => {
      var annotationType;
      //
      //  Get the incoming Annotation Type
      //
      if ((msg.wwsAnnotationType === undefined) || (msg.wwsAnnotationType.trim() === '')) {
        //
        //  There is an issue
        //
        console.log("wwsFilterAnnotations: Missing AnnotationType Information");
        node.status({fill:"red", shape:"dot", text:"Missing AnnotationType Information"});
        node.error('wwsFilterAnnotations: Missing AnnotationType Information', msg);
        return;
      }
      annotationType = msg.wwsAnnotationType.trim();
      if (config.filterOutputs2) {
        //
        //  Check if the incoming actionId is in the list
        //
        let items = config.hidden_string.split(',');
        let theIndex = -1;
        for (let k = 0; k < items.length; k++) {
          if (items[k].trim() === 'message-nlp-all') {
            //
            //  we have the special case where all NLP annotations are delivered through a single output (nlp-all)
            //
            switch (annotationType) {
              case 'message-nlp-keywords':
                if (config.o_messageNlpKeywords) {
                  //
                  //  we deliver this NLP through the NLP-ALL output
                  //
                  theIndex = k;
                }
                break;
              case 'message-nlp-entities':
                if (config.o_messageNlpEntities) {
                  //
                  //  we deliver this NLP through the NLP-ALL output
                  //
                  theIndex = k;
                }
                break;
              case 'message-nlp-docSentiment':
                if (config.o_messageNlpDocSentiment) {
                  //
                  //  we deliver this NLP through the NLP-ALL output
                  //
                  theIndex = k;
                }
                break;
              case 'message-nlp-relations':
                if (config.o_messageNlpRelations) {
                  //
                  //  we deliver this NLP through the NLP-ALL output
                  //
                  theIndex = k;
                }
                break;
              case 'message-nlp-concepts':
                if (config.o_messageNlpConcepts) {
                  //
                  //  we deliver this NLP through the NLP-ALL output
                  //
                  theIndex = k;
                }
                break;
              case 'message-nlp-taxonomy':
                if (config.o_messageNlpTaxonomy) {
                  //
                  //  we deliver this NLP through the NLP-ALL output
                  //
                  theIndex = k;
                }
                break;
              case 'message-nlp-dates':
                if (config.o_messageNlpDates) {
                  //
                  //  we deliver this NLP through the NLP-ALL output
                  //
                  theIndex = k;
                }
                break;
            }
            //
            //  We break the outer loop when found
            //
            if (theIndex >= 0) break;
          } else {
            //
            //  This is normal behavior, where each annotationType corresponds to only one output
            //
            if (items[k].trim() === annotationType) {
              theIndex = k;
              //
              //  We break the outer loop when found
              //
              break;
            } 
          }
        }
        if (theIndex < 0) {
          //
          //  The Annotation is not part of the ones that the node is able to manage
          //
          console.log("wwsFilterAnnotations: AnnotationType " + annotationType + ' is NOT Processed');
          node.status({fill:"yellow", shape:"square", text:"AnnotationType  " + annotationType + " NOT processed"});
          return;
        } else {
          //
          //  Build an array of NULL messages
          //
          let outArray = [];
          for (let k = 0; k < items.length; k++) {
              outArray.push(null);
          }
          //
          //  Now fill the answer in the right position :-)
          //
          outArray[theIndex] = msg;
          //
          //  Provide the answer
          //
          console.log("wwsFilterAnnotations: Filtering annotation " + annotationType + ' through the output '+ theIndex);
          node.status({fill: "green", shape: "dot", text: "annotation processed " + annotationType});
          node.send(outArray);
          //
          //  Reset visual status on success
          //
          setTimeout(() => {node.status({});}, 2000);
        }
      } else {
        //
        //  Only one output. All Annotations go to the same
        //
        console.log("wwsFilterAnnotations: Pushing annotation " + annotationType + ' through the single output');
        node.status({fill: "green", shape: "dot", text: "annotation processed " + annotationType});
        node.send(msg);
        //
        //  Reset visual status on success
        //
        setTimeout(() => {node.status({});}, 2000);
      }
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
  //
  //  Get Template
  //
  function wwsGetTemplate(config) {
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
      node.error("wwsGetTemplate: Please configure your Watson Workspace App first!");
      return;
    }
    var graphQL_url = node.application.getApiUrl() + "/graphql";
    //
    //  Now wait for the input to this node
    //
    this.on("input", (msg) => {
      var templateId = '';
      if ((config.wwsTemplateId === '') && 
          ((msg.wwsTemplateId === undefined) || (msg.wwsTemplateId === ''))) {
        //
        //  There is an issue
        //
        console.log("wwsGetTemplate: Missing templateID Information");
        node.status({fill:"red", shape:"dot", text:"Missing TemplateID"});
        node.error('wwsGetTemplate: Missing TemplateID', msg);
        return;
      }
      if (config.wwsTemplateId !== '') {
        templateId = config.wwsTemplateId;
      } else {
        templateId = msg.wwsTemplateId;
      }
      //
      //  Prepare the operation
      //
      var query = _getTemplateQuery(templateId);
      var req = _graphQL_options(msg.wwsToken, graphQL_url, query, BETA_EXP_FLAGS);
      //
      //  Perform the operation
      //
      node.status({fill:"blue", shape:"dot", text:"Getting Template..."});
      node.application.wwsRequest(req)
      .then((res) => {
        if (res.errors) {
          //
          //  Query Successfull but with Errors
          //
          msg.wwsQLErrors = res.errors;
          console.log('wwsGetTemplate: some errors found in query');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "yellow", shape: "dot", text: "Some Errors in query"});
        } else {
          //
          //  Successfull Result !
          //
          console.log('wwsGetTemplate: Success from graphQL query');
          node.status({fill: "green", shape: "dot", text: "graphQL Query success"});
        }
        msg.payload = res.data;
        node.send(msg);
        //
        //  Reset visual status on success
        //
        setTimeout(() => {node.status({});}, 2000);
      }).catch((err) => {
        console.log("wwsGetTemplate: Error while posting GraphQL query to WWS.", err);
        node.status({fill: "red", shape: "ring", text: "Sending query failed..."});
        node.error("wwsGetTemplate: Sending query failed...", err);
        return;
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
  //
  //  Get Templated Space
  //
  function wwsGetTemplatedSpace(config) {
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
      node.error("wwsGetTemplatedSpace: Please configure your Watson Workspace App first!");
      return;
    }
    var graphQL_url = node.application.getApiUrl() + "/graphql";
    //
    //  Now wait for the input to this node
    //
    this.on("input", (msg) => {
      var query = '';
      var theSpace = '';
      switch (config.SpaceOperation) {
        case 'byId':
          if ((config.wwsSpaceId === '') && 
              ((msg.wwsSpaceId === undefined) || (msg.wwsSpaceId === ''))) {
            //
            //  There is an issue
            //
            console.log("wwsGetTemplatedSpace: Missing spaceID Information");
            node.status({fill:"red", shape:"dot", text:"Missing SpaceID"});
            node.error('wwsGetTemplatedSpace: Missing SpaceID', msg);
            return;
          }
          if (config.wwsSpaceId !== '') {
            theSpace = config.wwsSpaceId;
          } else {
            theSpace = msg.wwsSpaceId;
          }
          //
          //  Prepare the operation
          //
          query = _getTemplatedSpaceQuery(theSpace);
          break;
        case 'byName':
          if ((config.wwsSpaceName === '') && 
              ((msg.wwsSpaceName === undefined) || (msg.wwsSpaceName === ''))) {
            //
            //  There is an issue
            //
            console.log("wwsGetTemplatedSpace: Missing spaceName Information");
            node.status({fill:"red", shape:"dot", text:"Missing SpaceName"});
            node.error('wwsGetTemplatedSpace: Missing SpaceName', msg);
            return;
          }
          if (config.wwsSpaceName !== '') {
            theSpace = config.wwsSpaceName;
          } else {
            theSpace = msg.wwsSpaceName;
          }
          //
          //  Prepare the operation
          //
          query = _getSearchSpaces(theSpace);
          break;
        case 'mySpaces':
          //
          //  Prepare the operation
          //
          query = _getMySpaces(theSpace);
          break;
        default:
      }
      var req = _graphQL_options(msg.wwsToken, graphQL_url, query, BETA_EXP_FLAGS);
      //
      //  Perform the operation
      //
      node.status({fill:"blue", shape:"dot", text:"Getting Space..."});
      node.application.wwsRequest(req)
      .then((res) => {
        if (res.errors) {
          //
          //  Query Successfull but with Errors
          //
          msg.wwsQLErrors = res.errors;
          console.log('wwsGetTemplatedSpace: some errors found in Query. Continuing....');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "yelloo", shape: "dot", text: "Some Errors in query"});
        } else {
          //
          //  Successfull Result !
          //
          console.log('wwsGetTemplatedSpace: Success from graphQL query');
          node.status({fill: "green", shape: "dot", text: "space " + theSpace + " retrieved"});
        }
        msg.payload = res.data;
        //
        //  Now we need to modify the properties in the output to be more descriptive
        //
        switch (config.SpaceOperation) {
          case 'byId':
            if (__makePropertiesAndStatusReadable(msg.payload.space, node)) {
              console.log('wwsGetTemplatedSpace: operation completed');
              node.status({fill: "green", shape: "dot", text: 'operation completed'});
              node.send(msg);
              //
              //  Reset visual status on success
              //
              setTimeout(() => {node.status({});}, 2000);
            };
            break;
          case 'byName':
          case 'mySpaces':
            let allOk = true;
            msg.payload.spaces = msg.payload.spaces.items;
            for (let i = 0; i < msg.payload.spaces.length; i++) {
              if (! __makePropertiesAndStatusReadable(msg.payload.spaces[i], node)) {
                allOk = false;
                break;
              }
            }
            if (allOk) {
              console.log('wwsGetTemplatedSpace: operation completed');
              node.status({fill: "green", shape: "dot", text: 'operation completed'});
              node.send(msg);
              //
              //  Reset visual status on success
              //
              setTimeout(() => {node.status({});}, 2000);
            };
            break;
          default:
        }
    }).catch((err) => {
        console.log("wwsGetTemplatedSpace: Error while posting GraphQL query to WWS.", err);
        node.status({fill: "red", shape: "ring", text: "Sending query failed..."});
        node.error("wwsGetTemplatedSpace: Sending query failed...", err);
        return;
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
  //
  //  Update Templated Space
  //
  function wwsUpdateSpace(config) {
    RED.nodes.createNode(this, config);

    var betweenQuotes = /"([^"\\]*(\\.[^"\\]*)*)"/;
    var parExp = /(\S+)\s*=\s*([^\s"]+|"[^"]*")/;

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
      node.error("wwsUpdateSpace: Please configure your Watson Workspace App first!");
      return;
    }
    var graphQL_url = node.application.getApiUrl() + "/graphql";
    //
    //  Now wait for the input to this node
    //
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
        console.log("wwsUpdateSpace: Missing spaceID Information");
        node.status({fill:"red", shape:"dot", text:"Missing SpaceID"});
        node.error('wwsUpdateSpace: Missing SpaceID', msg);
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
        let theList = null;
        if (config.wwsMemberList.trim() !== '') {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          theList = config.wwsMemberList.trim().split(',');
        } else {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          theList = msg.wwsMemberList.trim().split(',');
        }
        for (let i=0; i < theList.length; i++) {
          theList[i] = theList[i].trim();
        }
        members = theList;
      }
      //
      //  If there is nothing to be modified, then we exit without doing anything :-)
      //
      if ((newStatus === null) && (properties === null) && (members === null)) {
        //
        //  There is nothing to do
        //
        console.log("wwsUpdateSpace: Nothing to UPDATE");
        node.status({fill:"yellow", shape:"square", text:"Nothing to update"});
        node.warn('wwsUpdateSpace: nothing to Update...')
        node.send(msg);
        return;
      }
      //
      //  Since there is something to do, we need to translate property names, property values (for lists) and statusValues from readable strings to IDs
      //  In order to do this, we first need to get information about the template from which this space has been created
      //
      //
      //  Prepare the operation
      //
      var query = _getTemplatedSpaceQuery(spaceId);
      var req = _graphQL_options(msg.wwsToken, graphQL_url, query, BETA_EXP_FLAGS);
      //
      //  Perform the operation
      //
      node.status({fill:"blue", shape:"dot", text:"Getting Space first..."});
      node.application.wwsRequest(req)
      .then((res) => {
        if (res.errors) {
          //
          //  Query Successfull but with Errors
          //
          msg.wwsQLErrors = res.errors;
          console.log('wwsUpdateSpace: Some errors found in getting the Template');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "yellow", shape: "dot", text: "some Errors getting the Template"});
        } else {
          //
          //  Ok, we should have the information about the teamplate.
          //  We need to parse them
          //
          console.log('wwsUpdateSpace: Success getting Space infos');
          node.status({fill: "green", shape: "dot", text: "Space succesfully retrieved"});
        }
        if (res.data && res.data.space && res.data.space.templateInfo) {
          let templateInfo = res.data.space.templateInfo;
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
              console.log('wwsUpdateSpace: Status ' + newStatus + ' is unknown!');
              node.status({fill: "red", shape: "dot", text: 'Status ' + newStatus + ' is unknown!'});
              node.error('wwsUpdateSpace: Status ' + newStatus + ' is unknown!', msg);
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
              console.log('wwsUpdateSpace: ' + properties[outProps].name + ' is unknown or its value ' + properties[outProps].value);
              node.status({fill: "red", shape: "dot", text: properties[outProps].name + ' is unknown or its value ' + properties[outProps].value});
              node.error('wwsUpdateSpace: ' + properties[outProps].name + ' is unknown or its value ' + properties[outProps].value, msg);
              return;
            }
          }
          //
          //  Build the Variables
          //
          let variables = '{"input":';
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
          console.log('wwsUpdateSpace: Updating Space ' + spaceId + ' with these data :');
          console.log(variables);
          console.log('-------------------------------------------');
          //
          //  Now we can proceed building the mutation to modify the space
          //  Build the mutation
          //
          var mutation = _updateSpaceMutation();
          var req = _graphQL_options(msg.wwsToken, graphQL_url, mutation, BETA_EXP_FLAGS, variables);
          //
          //  Issue the Update Statement
          //
          node.status({fill:"blue", shape:"dot", text:"Updating Space..."});
          node.application.wwsRequest(req)
          .then((res) => {
            if (res.errors) {
              //
              //  Mutation Successfull but with Errors
              //
              msg.wwsQLErrors = res.errors;
              console.log('wwsUpdateSpace: Some errors found in updating space ' + spaceId);
              console.log(JSON.stringify(res.errors));
              node.status({fill: "yellow", shape: "dot", text: 'Some Errors updating space ' + spaceId});
            } else {
              //
              //  Successfull results
              //
              console.log('wwsUpdateSpace: Space ' + spaceId + ' UPDATED !!');
              node.status({fill: "green", shape: "dot", text: "Space Updated !"});
            }
            msg.payload = res.data.updateSpace;
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
              console.log('wwsUpdateSpace: Status ' + msg.payload.space.statusValueId + ' is unknown!');
              node.status({fill: "red", shape: "dot", text: 'Status ' + msg.payload.space.statusValueId + ' is unknown!'});
              node.error('wwsUpdateSpace: Status ' + msg.payload.space.statusValueId + ' is unknown!', msg);
              return;
            }
            node.send(msg);
            //
            //  Reset visual status on success
            //
            setTimeout(() => {node.status({});}, 2000);
          }).catch((err) => {
            console.log("wwsUpdateSpace: Error updating space.", err);
            node.status({fill: "red", shape: "ring", text: "Error updating space..."});
            node.error("wwsUpdateSpace: Error updating space.", err);
            return;
          });
        } else {
          //
          //  Issues with getting the TEMPLATE !!!
          //
          console.log("wwsUpdateSpace: Error while getting templatedSpace TWO.");
          node.status({fill: "red", shape: "ring", text: "Error while getting templatedSpace TWO..."});
          node.error("wwsUpdateSpace: Error while getting templatedSpace TWO.", res.data);
          return;
        }
      }).catch((err) => {
        console.log("wwsUpdateSpace: Error while getting templatedSpace.", err);
        node.status({fill: "red", shape: "ring", text: "Error while getting templatedSpace..."});
        node.error("wwsUpdateSpace: Error while getting templatedSpace.", err);
        return;
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
  //
  //  Create Space from Template
  //
  function wwsCreateSpaceFromTemplate(config) {
    RED.nodes.createNode(this, config);

    var betweenQuotes = /"([^"\\]*(\\.[^"\\]*)*)"/;
    var parExp = /(\S+)\s*=\s*([^\s"]+|"[^"]*")/;

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
      node.error("wwsCreateSpaceFromTemplate: Please configure your Watson Workspace App first!");
      return;
    }
    var graphQL_url = node.application.getApiUrl() + "/graphql";
    //
    //  Now wait for the input to this node
    //
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
        console.log("wwsCreateSpaceFromTemplate: Missing templateID Information");
        node.status({fill:"red", shape:"dot", text:"Missing templateID"});
        node.error('wwsCreateSpaceFromTemplate: Missing templateID', msg);
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
        console.log("wwsCreateSpaceFromTemplate: Missing Space Name Information");
        node.status({fill:"red", shape:"dot", text:"Missing Space Name"});
        node.error('wwsCreateSpaceFromTemplate: Missing Space Name', msg);
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
          //  Now we should have processed all the pairs in the config input
          //
        } else {
          //
          //  if inpput comes as "msg.wwsPropertyList" we assume that it is 
          //  already formatted as an array of name and values
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
        let theList = null;
        if (config.wwsMemberList.trim() !== '') {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          theList = config.wwsMemberList.trim().split(',');
        } else {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          theList = msg.wwsMemberList.trim().split(',');
        }
        for (let i=0; i < theList.length; i++) {
          theList[i] = theList[i].trim();
        }
        members = theList;
      }
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
      }
      //
      //  At this point, we need to get the Template
      //
      let query = _getTemplateQuery(templateId);
      let req = _graphQL_options(msg.wwsToken, graphQL_url, query, BETA_EXP_FLAGS);
      //
      //  Perform the operation
      //
      node.status({fill:"blue", shape:"dot", text:"Getting Template..."});
      node.application.wwsRequest(req)
      .then((res) => {
        if (res.errors) {
          //
          //  Query Successfull but with Errors
          //
          msg.wwsQLErrors = res.errors;
          console.log("wwsCreateSpaceFromTemplate: Some Errors in retrieving TemplateId " + templateId);
          console.log(JSON.stringify(res.errors));
          node.status({fill: "yellow", shape: "dot", text: "Some Errors retrieving TemplateId " + templateId});
        } else {
          //
          //  Successfull Result ! HABEMUS TEMPLATE
          //
          console.log('wwsCreateSpaceFromTemplate: Success retrieving Template ' + templateId);
          node.status({fill: "green", shape: "dot", text: "template " + templateId + " retrieved"});
        }
        let templateProperties; 
        let statuses;
        try {
          templateProperties = res.data.spaceTemplate.properties.items;
          statuses = res.data.spaceTemplate.spaceStatus.acceptableValues;
        } catch (e) {
          //
          //  This means that the essential informations we need from the Template are not there
          //
          console.log("wwsCreateSpaceFromTemplate: Error getting information from Template.", e);
          node.status({fill: "red", shape: "ring", text: "Error getting information from Template."});
          node.error("wwsCreateSpaceFromTemplate: Error getting information from Template.", e);
          return;
        }
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
            console.log('wwsCreateSpaceFromTemplate: Property ' + properties[outProperties].name + ' or its value ' + properties[outProperties].value + ' is not allowed');
            node.status({fill: "red", shape: "dot", text: 'Property ' + properties[outProperties].name + ' or its value ' + properties[outProperties].value + ' is not allowed'});
            node.error('wwsCreateSpaceFromTemplate: Property ' + properties[outProperties].name + ' or its value ' + properties[outProperties].value + ' is not allowed', msg);
            return;
          }
        } else {
          //
          //  No Properties
          //
        }
        variables += '}}';
        console.log('wwsCreateSpaceFromTemplate: Creating Space ' + spaceName + ' from template ' + templateId + ' with these data :');
        console.log(variables);
        console.log('------------------');
        //
        //  The Mutation is independent if there are Properties or not (this will change the way in which the "variables" will be defined)
        //  So we can define the mutation upfront
        //
        let mutation = _createSpaceMutation();
        let req = _graphQL_options(msg.wwsToken, graphQL_url, mutation, BETA_EXP_FLAGS, variables);
        //
        //  Issue the create Statement
        //
        node.status({fill:"blue", shape:"dot", text:"Creating Space..."});
        node.application.wwsRequest(req)
        .then((res) => {
          if (res.errors) {
            //
            //  Query Successfull but with Errors
            //
            msg.wwsQLErrors = res.errors;
            console.log('wwsCreateSpaceFromTemplate: Some errors in creating space ' + spaceName + ' from template ' + templateId);
            console.log(JSON.stringify(res.errors, ' ', 2));
            node.status({fill: "yellow", shape: "dot", text: 'Some Errors in creating space ' + spaceName + ' from template ' + templateId});
          } else {
            //
            //  Successfull Result !
            //
            console.log('wwsCreateSpaceFromTemplate: Space ' + spaceName + ' CREATED !!');
            node.status({fill: "green", shape: "dot", text: "Space Created !"});
          }
          msg.payload = res.data.createSpace;
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
            console.log('wwsCreateSpaceFromTemplate: Status ' + msg.payload.space.statusValueId + ' is unknown!');
            node.status({fill: "red", shape: "dot", text: 'Status ' + msg.payload.space.statusValueId + ' is unknown!'});
            node.error('wwsCreateSpaceFromTemplate: Status ' + msg.payload.space.statusValueId + ' is unknown!', msg);
            return;
          } 
          node.send(msg);
          //
          //  Reset visual status on success
          //
          setTimeout(() => {node.status({});}, 2000);
        }).catch((err) => {
          console.log("wwsCreateSpaceFromTemplate: Error creating space " + spaceName + ' from template ' + templateId, err);
          node.status({fill: "red", shape: "ring", text: "Error creating space " + spaceName + ' from template ' + templateId});
          node.error("wwsCreateSpaceFromTemplate: Error creating space " + spaceName + ' from template ' + templateId, err);
          return;
        });
      }).catch((err) => {
        console.log("wwsCreateSpaceFromTemplate: Error getting Template Infos.", err);
        node.status({fill: "red", shape: "ring", text: "Error getting Template Infos."});
        node.error("wwsCreateSpaceFromTemplate: Error getting Template Infos.", err);
        return;
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
  //
  //  Add Focus
  //
  function wwsAddFocus(config) {
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
      node.error("wwsAddFocus: Please configure your Watson Workspace App first!");
      return;
    }
    var graphQL_url = node.application.getApiUrl() + "/graphql";
    //
    //  Now wait for the input to this node
    //
    this.on("input", (msg) => {
      var messageId = '';
      var theString = '';
      var actionId = '';
      var lens = '';
      var category = '';
      var thePayload = '';
      //
      //  Which Message needs to be added focus ?
      //
      if ((config.wwsMessageId.trim() === '') && 
          ((msg.wwsMessageId === undefined) || (msg.wwsMessageId.trim() === ''))) {
        //
        //  There is an issue
        //
        console.log("wwsAddFocus: Missing messageID Information");
        node.status({fill:"red", shape:"dot", text:"Missing messageID"});
        node.error('wwsAddFocus: Missing messageID', msg);
        return;
      }
      if (config.wwsMessageId.trim() !== '') {
        messageId = config.wwsMessageId.trim();
      } else {
        messageId = msg.wwsMessageId.trim();
      }

      //
      //  Which String needs to be recognized ?
      //
      if ((config.wwsString.trim() === '') && 
          ((msg.wwsString === undefined) || (msg.wwsString.trim() === ''))) {
        //
        //  There is an issue
        //
        console.log("wwsAddFocus: Missing String Information");
        node.status({fill:"red", shape:"dot", text:"Missing String"});
        node.error('wwsAddFocus: Missing String', msg);
        return;
      }
      if (config.wwsString.trim() !== '') {
        theString = config.wwsString.trim();
      } else {
        theString = msg.wwsString.trim();
      }

      //
      //  Which Actions needs to be proposed as focus ?
      //
      if ((config.wwsActionId.trim() === '') && 
          ((msg.wwsActionId === undefined) || (msg.wwsActionId.trim() === ''))) {
        //
        //  There is an issue
        //
        console.log("wwsAddFocus: Missing ActionID Information");
        node.status({fill:"red", shape:"dot", text:"Missing ActionID"});
        node.error('wwsAddFocus: Missing ActionID', msg);
        return;
      }
      if (config.wwsActionId.trim() !== '') {
        actionId = config.wwsActionId.trim();
      } else {
        actionId = msg.wwsActionId.trim();
      }

      //
      //  Which LENS needs to be proposed as focus ?
      //
      if ((config.wwsLens.trim() === '') && 
          ((msg.wwsLens === undefined) || (msg.wwsLens.trim() === ''))) {
        //
        //  There is an issue
        //
        console.log("wwsAddFocus: Missing Lens Information");
        node.status({fill:"red", shape:"dot", text:"Missing Lens"});
        node.error('wwsAddFocus: Missing Lens', msg);
        return;
      }
      if (config.wwsLens.trim() !== '') {
        lens = config.wwsLens.trim();
      } else {
        lens = msg.wwsLens.trim();
      }

      //
      //  Is there a Category (OPTIONAL) ?
      //
      if (config.wwsCategory.trim() !== '') {
        category = config.wwsCategory.trim();
      } else {
        if ((msg.wwsCategory !== undefined) && (msg.wwsCategory.trim() !== '')) {
          category = msg.wwsCategory.trim();
        } else {
          console.log("wwsAddFocus: Missing OPTIONAL Category Information");
        }
      }

      //
      //  Is there a Payload (OPTIONAL) ?
      //
      if (config.wwsPayload.trim() !== '') {
        thePayload = config.wwsPayload.trim();
      } else {
        if ((msg.wwsPayload !== undefined) && (msg.wwsPayload.trim() !== '')) {
          thePayload = msg.wwsPayload.trim();
        } else {
          console.log("wwsAddFocus: Missing OPTIONAL PAYLOAD Information");
        }
      }
      //
      //  Prepare the operation
      //
      var query = _getMessageInformation(messageId);
      var req = _graphQL_options(msg.wwsToken, graphQL_url, query, 'PUBLIC');
      //
      //  Perform the operation
      //
      node.status({fill:"blue", shape:"dot", text:"Getting Message..."});
      node.application.wwsRequest(req)
      .then((res) => {
        if (res.errors) {
          //
          //  Query Successfull but with Errors
          //
          msg.wwsQLErrors = res.errors;
          console.log('wwsAddFocus: Some Errors from messageId query');
          console.log(JSON.stringify(res.errors, ' ', 2));
          node.status({fill: "yellow", shape: "dot", text: "Some Errors from messageId query"});
        } else {
          //
          //  Ok, we got the information for the message...
          //
          console.log('wwsAddFocus: Success from graphQL query : message ' + messageId + ' retrieved');
          node.status({fill: "green", shape: "dot", text: "Message " + messageId + " retrieved..."});
        }
        //
        //  Now we have the message. Check if the message contains the STRING to be annotated.
        //
        let mutation = '';
        let annotations = _parseAnnotations(res.data.message.annotations);
        if (res.data.message.content) {
          //
          //  the message.content is present
          //
          if (res.data.message.content.indexOf(theString) >= 0) {
            //
            //  the String is in the CONTENT of the original Message
            //
            console.log('wwsAddFocus: String ' + theString + ' found in Message. Going to add new Focus to ' + messageId + ' ....');
            node.status({fill:"blue", shape:"dot", text:"Adding Focus to messsage..."});
            mutation = _addFocusMutation(messageId, res.data.message.content, theString, actionId, lens, category, thePayload);
          } else {
            //
            //  There is CONTENT but the STRING is not part of the content. 
            //  We do not have much to do if not informing the user and ignoring the ADD FOCUS
            //
            console.log('wwsAddFocus: String ' + theString + ' NOT found in Message. NO FOCUS will be added ....');
            node.status({fill:"yellow", shape:"square", text: "No focus added to Message"});
            node.warn('wwsAddFocus: Focus not addes as ' + theString + ' is not part of the text for messageid ' + messageId + ' ...')
          }
        } else {
          //
          //  The message.content is NOT present.
          //  Maybe we need to find it in the GENERIC ANNOTATION....
          //
          if (annotations) {
            for (let i=0; i < annotations.length; i++) {
              if (annotations[i].type === 'generic') {
                if (annotations[i].text && (annotations[i].text.indexOf(theString) >= 0)) {
                  //
                  //  the string is succesfully found in the GENERIC annotation
                  //
                  console.log('wwsAddFocus: String ' + theString + ' found in Annotation. Going to add new Focus to ' + messageId + ' ....');
                  node.status({fill:"blue", shape:"dot", text:"Adding Focus to Annotation..."});
                  mutation = _addFocusMutation(messageId, annotations[i].text, theString, actionId, lens, category, thePayload);
                } else {
                  //
                  //  There is a GENERIC ANNOTATION but the STRING is not part of the TEXT. 
                  //  We do not have much to do if not informing the user and ignoring the ADD FOCUS
                  //
                  console.log('wwsAddFocus: String ' + theString + ' NOT found in Annotation. NO FOCUS will be added ....');
                  node.status({fill:"yellow", shape:"square", text: "No focus added to Annotation"});
                  node.warn('wwsAddFocus: Focus not addes as ' + theString + ' is not part of the text for any ' + messageId + ' Annotations...')
                }
                break;
              }
            }
          } else {
            //
            //  No annotations. So the STRING cannot be searched
            //
            console.log('wwsAddFocus: String ' + theString + ' NOT found in UNEXISTING Annotations. NO FOCUS will be added ....');
            node.status({fill:"yellow", shape:"square", text: "No focus added to Unexisting Annotations"});
            node.warn('wwsAddFocus: Focus not addes as ' + theString + ' is not part of the text for any ' + messageId + ' UNEXISTENT Annotations...')
          }
        }
        //
        //  If the mutation string will be empty, this means that we did not find the STRING either in the message.content or in its generic annotation
        //
        if (mutation !== '') {
          //
          //  Perform the AddFocus Mutation 
          //
          let req = _graphQL_options(msg.wwsToken, graphQL_url, mutation, BETA_EXP_FLAGS);
          node.application.wwsRequest(req)
          .then((res) => {
            if (res.errors) {
              //
              //  Query Successfull but with Errors
              //
              msg.wwsQLErrors = res.errors;
              console.log('wwsAddFocus: Some errors in addFocus mutation');
              console.log(JSON.stringify(res.errors, ' ', 2));
              node.status({fill: "yellow", shape: "dot", text: "Some Errors in addFocus mutation"});
            } else {
              //
              //  Successfull Result !
              //
              console.log('wwsAddFocus: Success from graphQL query');
              node.status({fill: "green", shape: "dot", text: "Focus added"});
            }
            msg.payload = res.data.addMessageFocus.message;
            msg.payload.annotations = _parseAnnotations(msg.payload.annotations);
            msg.wwsFocusAdded = true;
            node.send(msg);
            //
            //  Reset visual status on success
            //
            setTimeout(() => {node.status({});}, 2000);
          }).catch((err) => {
            console.log("wwsAddFocus: Error while posting addFocus mutation");
            console.log(JSON.stringify(err, ' ', 2));
            node.status({fill: "red", shape: "ring", text: "Posting addFocus mutation failed."});
            node.error("wwsAddFocus: Error while posting addFocus mutation", err);
            return;
          });
        } else {
          //
          //  Do not perform the AddFocus mutation
          //
          msg.payload = res.data.message;
          msg.payload.annotations = _parseAnnotations(msg.payload.annotations);
          msg.wwsFocusAdded = false;
          node.send(msg);
        }
      })
      .catch((err) => {
        msg.payload = err;
        console.log("wwsAddFocus: Error querying for messageId " + messageId, err);
        node.status({fill: "red", shape: "ring", text: "error querying for messageId"});
        node.error('wwsAddFocus: Error querying for messageId ' + messageId, msg);
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
  //
  //  Add Focus
  //
  function wwsActionFulfillment(config) {
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
      node.error("wwsActionFulfillment: Please configure your Watson Workspace App first!");
      return;
    }
    var graphQL_url = node.application.getApiUrl() + "/graphql";
    //
    //  Now wait for the input to this node
    //
    this.on("input", (msg) => {
      var AFElements = '';
      var AFMutation = '';
      var AFType     = '';
      //
      //  Check for the AFElements input
      //
      if ( (msg.wwsAFElements === undefined) || 
           (!Array.isArray(msg.wwsAFElements)) || 
           (msg.wwsAFElements.length <= 0) ) {
        //
        //  There is an issue
        //
        console.log("wwsActionFulfillment: Missing AF Elements Information");
        node.status({fill:"red", shape:"dot", text:"Missing AF Elements"});
        node.error('wwsActionFulfillment: Missing AF Elements', msg);
        return;
      }
      AFElements = msg.wwsAFElements;

      //
      //  Check for the AFMutation input
      //
      if ((msg.wwsAFMutation === undefined) || (msg.wwsAFMutation.trim() === '')) {
        //
        //  There is an issue
        //
        console.log("wwsActionFulfillment: Missing AF Mutation Information");
        node.status({fill:"red", shape:"dot", text:"Missing AF Mutation"});
        node.error('wwsActionFulfillment: Missing AF Mutation', msg);
        return;
      }
      AFMutation = msg.wwsAFMutation.trim();

      //
      //  Check the type of Operation (Attachments or Annotations)
      //
      if (config.AF_Operation === "fromMsg") {
        //
        //  Value comes from input !
        //
        if (msg.wwsAFType && 
            ((msg.wwsAFType === "Attachments") || (msg.wwsAFType === "Annotations"))) {
              //
              //  Good value
              //
              AFType = msg.wwsAFType;
        } else {
          //
          //  There is an issue
          //
          console.log("wwsActionFulfillment: Missing AFType Information");
          node.status({fill:"red", shape:"dot", text:"Missing AF Type"});
          node.error('wwsActionFulfillment: Missing AF Type', msg);
          return;
        } 
      } else {
        //
        //  Value is in the Configuration Panle
        //
        AFType = config.AF_Operation;
      }
      //
      //  Build the replacement string for the placeholder in the AFMutation string
      //
      var details = '';
      if (AFType === 'Attachments') {
        //
        //  We have now to interpret the AFElements array for attachments
        //
        details += 'attachments : [';
        for (let i = 0; i < AFElements.length; i++) {
          if (i !== 0) details += ',';
          details += ' {type: CARD, cardInput: {type: INFORMATION, informationCardInput: {';
          details += ' title: "' + (AFElements[i].title) + '",';
          details += ' subtitle: "' + (AFElements[i].subtitle) + '",';
          details += ' text: "' + (AFElements[i].text) + '",';
          if (AFElements[i].date) {
            details += ' date: "' + AFElements[i].date + '"';
          } else {  
            details += ' date: "' + Math.floor(new Date()) + '"';
          }
          if (AFElements[i].buttons && Array.isArray(AFElements[i].buttons)) {
            //
            //  There are buttons
            //
            details += ', buttons: [';
            for (let j=0; j < AFElements[i].buttons.length; j++) {
              if (j !== 0) details += ',';
              details += ' {text: "' + (AFElements[i].buttons[j].text) + '",';
              details += ' payload: "' + (AFElements[i].buttons[j].payload) + '",';
              details += ' style: ';
              if (AFElements[i].buttons[j].isPrimary) {
                details += 'PRIMARY}'
              } else {
                details += 'SECONDARY}'
              }
            }
            details += ']';
          } else {
            //
            //  No Buttons... Skipping
            //
          }
          details += '}}}';
        }
        details += ']';
      } else {
        //
        //  We have now to interpret the AFElements array for annotations
        //
        details += 'annotations : [';
        for (let i = 0; i < AFElements.length; i++) {
          if (i !== 0) details += ',';
          details += ' {genericAnnotation : {';
          details += ' title: "' + (AFElements[i].title) + '",';
          details += ' text: "' + (AFElements[i].text) + '"';
          if (AFElements[i].buttons && Array.isArray(AFElements[i].buttons)) {
            //
            //  There are buttons
            //
            details += ', buttons: [';
            for (let j=0; j < AFElements[i].buttons.length; j++) {
              if (j !== 0) details += ',';
              details += '{postbackButton :';
              details += ' {title: "' + (AFElements[i].buttons[j].text) + '",';
              details += ' id: "' + (AFElements[i].buttons[j].payload) + '",';
              details += ' style: ';
              if (AFElements[i].buttons[j].isPrimary) {
                details += 'PRIMARY}'
              } else {
                details += 'SECONDARY}'
              }
              details += '}';
            }
            details += ']';
          } else {
            //
            //  No Buttons... Skipping
            //
          }
          details += '}}';
        }
        details += ']';
      }

      //
      //  Now we need to replace the placeholder in AFMutation with the details string we just built
      //
      AFMutation = AFMutation.replace('$$$$$$$$', details);
      console.log('wwsActionFulfillment: ready to execute ActionFulfillment mutation (see here) : ');
      console.log(AFMutation);
      console.log('--------------------------');
      var req = _graphQL_options(msg.wwsToken, graphQL_url, AFMutation, BETA_EXP_FLAGS);
      //
      //  Perform the operation
      //
      node.status({fill:"blue", shape:"dot", text:"creating ActionFulfillment..."});
      node.application.wwsRequest(req)
      .then((res) => {
        if (res.errors) {
          //
          //  Query Successfull but with Errors
          //
          msg.wwsQLErrors = res.errors;
          console.log('wwsActionFulfillment: Some errors from AF mutation');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "yellow", shape: "dot", text: "Some Errors from AF mutation"});
        } else {
          //
          //  Successfull Result !
          //
          console.log('wwsActionFulfillment: ActionFulfillment mutation succesfully created');
          node.status({fill: "green", shape: "dot", text: "AF Created"});
        }
        msg.payload = res.data;
        node.send(msg);
        //
        //  Reset visual status on success
        //
        setTimeout(() => {node.status({});}, 2000);
      }).catch((err) => {
        console.log("wwsActionFulfillment: Error while posting AF mutation", err);
        node.status({fill: "red", shape: "ring", text: "Posting AF mutation failed."});
        node.error("wwsActionFulfillment: Error while posting AF mutation", err);
        return;
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



  RED.nodes.registerType("wws-graphql", wwsGraphQLNode);
  RED.nodes.registerType("wws-getMessage", wwsGetMessage);
  RED.nodes.registerType("wws-addRemoveMembers", wwsAddRemoveMembers);
  RED.nodes.registerType("wws-getPeople", wwsGetPersons);
  RED.nodes.registerType("wws-validateActions", wwsFilterActions);
  RED.nodes.registerType("wws-filterAnnotations", wwsFilterAnnotations);
  RED.nodes.registerType("wws-getTemplate", wwsGetTemplate);
  RED.nodes.registerType("wws-getTemplatedSpace", wwsGetTemplatedSpace);
  RED.nodes.registerType("wws-updateTemplatedSpace", wwsUpdateSpace);
  RED.nodes.registerType("wws-createSpaceFromTemplate", wwsCreateSpaceFromTemplate);
  RED.nodes.registerType("wws-addFocus", wwsAddFocus);
  RED.nodes.registerType("wws-actionFulfillment", wwsActionFulfillment);

 
  //
  //  Helper Methods to simplify the code to initialize the token
  //  ============================================================
  //

  //
  //  Helper function to parse Annotations to JSON
  //  =============================================
  //
  function _parseAnnotations(theAnnotations) {
    if (theAnnotations) {
      if (theAnnotations.length > 0) {
        let annotations = [];
        for (let i = 0; i < theAnnotations.length; i++) {
          annotations.push(JSON.parse(theAnnotations[i]));
        }
        return annotations;
      } else {
        return theAnnotations;
      }
    } else {
      return theAnnotations;
    }
  }
  function __myJSONparse(str) {
    try {
        let a = JSON.parse(str);
        return a;
    } catch (e) {
        return str;
    }
  }                             

  //
  //  Helper functions to prepare GraphQL Query
  //  ==========================================
  //
  function _graphQL_options(runtimeToken, graphQL_url, query, viewType, variables, operationName) {
    var options = {
      method: "POST",
      uri: graphQL_url,
      headers: {
        "x-graphql-view": viewType
      },
      json: true,
      body: {
        query: query
      }
    };
    //
    //  Fallback to support external provided tokens
    //
    if (runtimeToken) {
      options.headers.Authorization = "Bearer" + runtimeToken;
    }
    if (variables) options.body.variables = variables;
    if (operationName) options.body.operationName = operationName;

    console.log("_graphQL_options : executing graphQL call with these options");
    console.log(JSON.stringify(options, ' ', 2));
    console.log('-------------------------------------------------------')
    return options;
  }

  //
  //  Helper function to Match rules
  //  ===============================
  //  This code comes form the following article : https://stackoverflow.com/questions/26246601/wildcard-string-comparison-in-javascript
  //
  //  Examples
  //    alert(
  //      "1. " + matchRuleShort("bird123", "bird*") + "\n" +
  //      "2. " + matchRuleShort("123bird", "*bird") + "\n" +
  //      "3. " + matchRuleShort("123bird123", "*bird*") + "\n" +
  //      "4. " + matchRuleShort("bird123bird", "bird*bird") + "\n" +
  //      "5. " + matchRuleShort("123bird123bird123", "*bird*bird*") + "\n"
  //    );
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
  //  End of code coming form the following article : https://stackoverflow.com/questions/26246601/wildcard-string-comparison-in-javascript
  //  
  
  //
  //  Helper functions to match Template Property Ids and Status with their displayName
  //  =================================================================================
  //
  function __makePropertiesAndStatusReadable(theSpace, node) {
    if (theSpace && theSpace.propertyValueIds) {
      if (theSpace.templateInfo.properties) {
        theSpace.propertyValueNames = _propertiesIdsToNames(theSpace.propertyValueIds, theSpace.templateInfo.properties.items);
      } else {
        console.log('wwsGetTemplatedSpace : No Properties Information in TEMPLATE for space ' + theSpace.title + ' !!!');
        node.warn('wwsGetTemplatedSpace: No Properties Information in TEMPLATE for space ' + theSpace.title);
      }
    } else {
      console.log('wwsGetTemplatedSpace : No properties for space ' + theSpace.title + ' !!!');
    }
    //
    //  And now we need to add the name of the status
    //
    if (theSpace && theSpace.statusValueId) {
      if (theSpace.templateInfo && theSpace.templateInfo.spaceStatus) {
        let statuses = theSpace.templateInfo.spaceStatus.acceptableValues;
        let found = false;
        for (let i = 0; i < statuses.length; i++) {
          if (theSpace.statusValueId === statuses[i].id) {
            found = true;
            theSpace.statusValueName = statuses[i].displayName;
            break;
          }
        }
        if (!found) {
          //
          //  We cannot get the name of a status that does not exist
          //
          console.log('wwsGetTemplatedSpace: Status ' + theSpace.statusValueId + ' for space ' + theSpace.title + ' is unknown!');
          node.status({fill: "red", shape: "dot", text: 'Status ' + theSpace.statusValueId + ' is unknown!'});
          node.error('wwsGetTemplatedSpace: Status ' + theSpace.statusValueId + ' for space ' + theSpace.title + ' is unknown!', msg);
          return false;
        }
      } else {
        console.log('wwsGetTemplatedSpace : No Status Information in TEMPLATE for space ' + theSpace.title + ' !!!');
        node.warn('wwsGetTemplatedSpace: No Status Information in TEMPLATE for space ' + theSpace.title);
      }
    } else {
      console.log('wwsGetTemplatedSpace : No Status Information for space ' + theSpace.title + ' !!!');
    }
    return true;
  }
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

  //
  //  Helper functions to build GraphQL queries and mutations
  //
  function _personQL_details() {
    return '{id displayName email customerId presence photoUrl extId ibmUniqueID created updated}';
  }
  function _spaceQL_details() {
    var space = '{';
    space += 'id title description visibility membersUpdated';
    //
    //  Template Infos for the space 
    //
    space += ' templateInfo ' + _templateQL_details(); 
    space += ' members {pageInfo {startCursor endCursor hasNextPage hasPreviousPage} items ' + _personQL_details()+ '}';
    space += ' team {id displayName teamSettings {appApprovalEnabled}}';
    space += ' propertyValueIds {propertyId propertyValueId}';
    space += ' statusValueId ';
    space += ' created createdBy ' + _personQL_details();
    space += ' updated updatedBy ' + _personQL_details();
    space += ' conversation {id messages(first: 1) {items ' + _messageQL_details() + '}}';
    //space += ' activeMeeting { meetingNumber password}';
    space += '}';
    return space;
  }
  function _templateQL_details() {
    var template = '{';
    template += 'id name description labelIds';
    template += ' spaceStatus {acceptableValues {id displayName} defaultValue}';
    template += ' requiredApps{items {id}}';
    template += ' properties {items {id type displayName ';
    template += '... on SpaceListProperty {defaultValue acceptableValues {id displayName }} ... on SpaceTextProperty {defaultValue} ... on SpaceBooleanProperty {defaultStringValue}}}';
    template += ' created createdBy ' + _personQL_details();
    template += ' updated updatedBy ' + _personQL_details();
    template += '}';
    return template;
  }
  function _messageQL_details() {
    var message = '{';
    message += 'id content contentType annotations';
    message += ' created createdBy ' + _personQL_details();
    message += ' updated updatedBy ' + _personQL_details();
    message += ' reactions {reaction count viewerHasReacted}';
    message += '}';
    return message;
  }

  function _getMessageInformation(messageId) {
    var query = 'query getMessage {message(id: "' + messageId + '") ';
    query += _messageQL_details();
    query += '}';
    return query;
  }

  function _getPersonInformation(type, person) {
    var query = '';
    if (type === "byMail") {
      query = 'query getPersonByMail {person(email: "' + person + '") ' + _personQL_details() + '}';
    } else {
      if (type === "byId") {
        query = 'query getPersonById {person(id: "' + person + '") ' + _personQL_details() + '}';
      } else {
        if (type === "me") {
          query = 'query myself {me ' + _personQL_details() + '}';
        }
      }
    }
    return query;
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
    mutation += ', memberOperation: ' + operation + '}){memberIdsChanged space ' + _spaceQL_details() + '}}';
    return mutation;
  }

  function _createSpaceMutation() {
    var mutation = 'mutation createSpace($input: CreateSpaceInput!) {createSpace(input: $input) {space ';
    mutation += _spaceQL_details();
    mutation += '}}';
    return mutation;
  }
  function _updateSpaceMutation() {
    var mutation = 'mutation updateSpace($input: UpdateSpaceInput!) {updateSpace(input: $input) {space ';
    mutation += _spaceQL_details();
    mutation += '}}';
    return mutation;
  }

  function _getTemplateQuery(templateId) {
    var query = 'query spaceTemplate { spaceTemplate(id: "' + templateId + '") ';
    query += _templateQL_details();
    query += '}';
    return query;
  }
  function _getTemplatedSpaceQuery(spaceId) {
    var query = 'query getTemplatedSpace { space(id: "' + spaceId + '") ';
    query += _spaceQL_details();
    query += '}';
    return query;
  }
  function _getSearchSpaces(spaceName) {
    var query = 'query theSpaces { searchSpaces(title: "' + spaceName + '", sortBy: "activity") ';
    query += '{items ';
    query += _spaceQL_details();
    query += '}}';
    return query;
  }
  function _getMySpaces(spaceName) {
    var query = 'query mySpaces {spaces ';
    query += '{items ';
    query += _spaceQL_details();
    query += '}}';
    return query;
  }

  function _buildTargetedMessage(conversationId, updatedBy, targetDialogId) {
    var mutation = 'mutation {';
    mutation += 'createTargetedMessage(input: {';
    mutation += ' conversationId: "' +  conversationId + '",';
    mutation += ' targetUserId: "' +  updatedBy + '",';
    mutation += ' targetDialogId: "' + targetDialogId + '",';
    mutation += ' $$$$$$$$';
    mutation += ' }) {';
    mutation += ' successful';
    mutation += ' }';
    mutation += '}';
    return mutation;
  }

  function _addFocusMutation(messageId, theSentence, theString, actionId, lens, category, thePayload) {
    var mutation = '';
    mutation += 'mutation {addMessageFocus(input: {';
    mutation += 'messageId: "' + messageId + '", ';
    mutation += 'messageFocus: {';
    mutation += 'phrase: "' + escape(theSentence) + '", ';
    mutation += 'lens: "' + lens + '", ';
    if (category !== '') mutation += 'category: "' + category + '", ';
    mutation += 'actions: ["' + actionId + '"], ';
    mutation += 'confidence: 1, ';
    mutation += 'start: ' + theSentence.indexOf(theString) + ', ';
    mutation += 'end: ' + (theSentence.indexOf(theString) + theString.length) + ', ';
    if (thePayload !== '') mutation += 'payload: "' + escape(thePayload) + '", ';
    mutation += 'version: 1, ';
    mutation += 'hidden: false}}';
    mutation += ') {message ' + _messageQL_details() + '}';
    mutation += '}}';
    return mutation;
  }


  /*
  Mutation

  mutation updateSpace ($input:  UpdateSpaceInput!) {updateSpace(input: $input) {space {id title description team {id displayName teamSettings {appApprovalEnabled} } allowGuests visibility modifyMember modifyApp modifySpaceSetting templateId propertyValueIds { propertyId propertyValueId } statusValueId type userSpaceState { unread markedImportant predictedImportant important lastSpaceReadDate } created updated createdBy { id displayName email customerId presence photoUrl } activeMeeting { meetingNumber password }}}}"
variables 
"{"input":{"id":"5b101230e4b09834e0e434d7","propertyValues":[{"propertyId":"acdd0cba-c260-43c1-b77d-0d13526ca1ad","propertyValueId":"TRUE"},{"propertyId":"d2708223-02ca-4a28-b03b-4a9088fc589b","propertyValueId":"due"},{"propertyId":"e1b35006-2c50-4cc6-aab8-a3d1155db4c2","propertyValueId":"FALSE"},{"propertyId":"6409ec4c-1cbc-4f32-a9d8-e5113baaad46","propertyValueId":"9ad4db4c-3e6d-403e-8519-979f12f58d21"},{"propertyId":"66d8289c-706f-4223-b0b4-7def0a2ebfc9","propertyValueId":"00fddd0d-5aaf-487f-90db-ba98bcee321e"},{"propertyId":"285e5b11-ec29-4e72-b938-5dbaf8923442","propertyValueId":"uno"}]}}"
*/
};