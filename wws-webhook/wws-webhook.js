var bodyParser = require("body-parser");
var jsonParser = bodyParser.json();
var urlencParser = bodyParser.urlencoded({ extended: true });
var crypto = require('crypto');

module.exports = function(RED) {
  function wwsWebhookNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    this.application = RED.nodes.getNode(config.application);

    // CORS Handler
    this.corsHandler = function(req, res, next) { next(); }
    if (RED.settings.httpNodeCors) {
      this.corsHandler = cors(RED.settings.httpNodeCors);
      RED.httpNode.options("*", corsHandler);
    }

    // Error Handler
    this.errorHandler = function(err, req, res, next) {
      node.warn(err);
      res.sendStatus(500);
    };

    this.authenticateRequest = (body, outboundToken, webhookSecret) => {
      // console.log("authenticateVerificationRequest: ", outboundToken, webhookSecret, body);
      var hmac = crypto.createHmac("sha256", webhookSecret).update(body);
      var digest = hmac.digest("base64");
      // console.log("Digest: ", digest);
      if(digest === outboundToken) {
        console.log("Verification request authenticated.");
        return true;
      } else {
        console.log("Authentication of verification request failed.");
        return false;
      }
    }

    // Callback
    this.callback = (req, res) => {
      console.log("Received request.");
      var bodyString = JSON.stringify(req.body);
      if(this.authenticateRequest(bodyString, req.get("X-OUTBOUND-TOKEN"), config.webhookSecret)) {
        if(req.body.type === "verification") {
          console.log("Verification request.");
          var responseBody = {
            "response": req.body.challenge
          }
          var responseBodyString = JSON.stringify(responseBody);
          var hmac = crypto.createHmac("sha256", config.webhookSecret).update(responseBodyString);
          var digest = hmac.digest("base64");
          res.setHeader("X-OUTBOUND-TOKEN", digest);
          res.write(responseBodyString);
          res.status(200).end();
          console.log("Verification request successful.");
        } else {
          console.log("Notification request.");

          var msgid = RED.util.generateId();
          res._msgid = msgid;
          node.send({ _msgid: msgid, req: req, res: res, payload: req.body });
          
          res.status(200).end();
        }
      } else {
        console.log("Request authentication failed.");
        res.status(401).end();
      }
    };

    // RED.httpNode.post(config.url, cookieParser() ,httpMiddleware, corsHandler, metricsHandler, jsonParser, urlencParser, rawBodyParser, this.callback, this.errorHandler);
    RED.httpNode.post(config.webhookPath, this.corsHandler, jsonParser, urlencParser, this.callback, this.errorHandler);
  }

  RED.nodes.registerType("wws-webhook", wwsWebhookNode);
}
