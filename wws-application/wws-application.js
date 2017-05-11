var request = require("request");
var rp = require("request-promise-native");

module.exports = function(RED) {
  function wwsApplicationNode(config) {
    RED.nodes.createNode(this, config);
    this.appID = config.appID;
    this.appSecret = config.appSecret;
    this.auth = {
      accessToken: null,
      tokenExpiry: null,
      jti: null
    }

    this.getAccessToken = () => {
      var currentMilliseconds = new Date().valueOf();
      if(this.auth.accessToken && (this.auth.tokenExpiry > currentMilliseconds)) {
        console.log("Token still valid.");
        return Promise.resolve(this.auth);
      } else {
        console.log("New token required.");
        return getToken(this.appID, this.appSecret).then((body) => {
          this.auth.accessToken = body.access_token;
          this.auth.jti = body.jti;
          this.auth.tokenExpiry = currentMilliseconds + (body.expires_in * 1000);
          console.log("Successfully retrieved access token.");
          return this.auth;
        }).catch(function(err) {
          console.log("Error while fetching access token." + err)
        });
      }
    }

    this.getSpaces = () => {
      var query = "query getSpaces { spaces(first: 50) { items { id title } } }";

      return this.getAccessToken().then((auth) => {
        return wwsGraphQL(auth.accessToken, query, "", "").then((response) => {
          var spaces = response.data.spaces.items;
          return spaces;
        }).catch(function(err) {
          console.log("Error while getting list of spaces." + err)
        });
      }).catch(function(err) {
        console.log("Error while getting access token." + err)
      });
    }
  }
  RED.nodes.registerType("wws-application", wwsApplicationNode);

  // Helper functions
  function getToken(appID, appSecret) {
    var authorization = new Buffer(appID + ":" + appSecret).toString('base64');
    var host = "https://api.watsonwork.ibm.com";
    var uri = host + "/oauth/token";
    var options = {
      method: "POST",
      uri: uri,
      headers: {
        Authorization: "Basic " + authorization
      },
      form: {
        grant_type: "client_credentials"
      },
      json: true
    }
    return rp(options);
  }

  function wwsGraphQL(accessToken, query, operationName, variables) {
    var host = "https://api.watsonwork.ibm.com";
    var uri = host + "/graphql";
    var options = {
      method: "POST",
      uri: uri,
      headers: {
        Authorization: "Bearer " + accessToken
      },
      json: true,
      body: {
        query: query /*,
        operationName: operationName,
        variables: variables */
      }
    };
    console.log(options)
    return rp(options);
  }
}
