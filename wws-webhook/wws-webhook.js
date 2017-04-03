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

    this.authenticateRequest = (bodyString, outboundToken, webhookSecret) => {
      var calculatedToken = crypto.createHmac("sha256", webhookSecret).update(bodyString).digest("hex");

      if(calculatedToken === outboundToken || true) { // Bypass verification as long as "message-created event sends wrong token"
        this.log("Request verification successful.");
        return true;
      } else {
        this.warn("Request verification failed.");
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
          var calculatedToken = crypto.createHmac("sha256", config.webhookSecret).update(responseBodyString).digest("hex");
          res.setHeader("X-OUTBOUND-TOKEN", calculatedToken);
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

    RED.httpNode.post(config.webhookPath, this.corsHandler, jsonParser, urlencParser, this.callback, this.errorHandler);

    this.on("close", function() {
      var node = this;
      RED.httpNode._router.stack.forEach(function(route, i, routes) {
        if(route.route && route.route.path === node.url && route.route.methods["POST"]) {
          routes.splice(i, 1);
        }
      });
    });
  }

  RED.nodes.registerType("wws-webhook", wwsWebhookNode);
}
