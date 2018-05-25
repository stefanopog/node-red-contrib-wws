module.exports = function(RED) {
    "use strict";
    const OAuth2 = require('simple-oauth2');
    const StateMachine = require('javascript-state-machine');
    const urllib = require("url");
    const http = require("follow-redirects").http;
    const https = require("follow-redirects").https;
    const getRawBody = require('raw-body');
    const crypto = require('crypto');
    const rp = require("request-promise-native");


    function WWSNode(config) {
        RED.nodes.createNode(this, config);
        let stringOrDefault = (value, defaultValue) => {
            return typeof value == 'string' && value.length > 0 ? value : defaultValue;
        }
        this.accountName = config.accountName;
        if (!this.credentials.clientId) {
            this.error("No WWS credentials found!");
        }
        if (!this.credentials.clientSecret) {
            this.error("Missing Client Secret!");
        }
        this.api = config.api;
        this.tokenPath = stringOrDefault(config.tokenPath, undefined);
        this.revokePath = stringOrDefault(config.revokePath, undefined);
        this.authorizePath = stringOrDefault(config.authorizePath, undefined);

        var node = this;
        const credentials = {
            client: {
                id: node.credentials.clientId,
                secret: node.credentials.clientSecret
            },
            auth: {
                tokenHost: config.api,
                tokenPath: config.tokenPath,
                revokePath: config.revokePath,
                authorizeHost: config.api,
                authorizePath: config.authorizePath
            }
        };
        const oauth2 = OAuth2.create(credentials);
        const fsm = new StateMachine({
            init: 'no_token',
            transitions: [
                { name: 'obtain', from: 'no_token', to: 'has_token' },
                { name: 'invalidate', from: 'has_token', to: 'token_expired' },
                { name: 'renew', from: 'token_expired', to: 'has_token' },
                { name: 'failed', from: 'token_expired', to: 'no_token' }
            ],
            data: {appToken:""},
            methods: {
                onObtain: function(transition, statusNode) {
                    let tokenConfig = {};
                    return new Promise((resolve, reject) => {
                        oauth2.clientCredentials.getToken(tokenConfig)
                            .then((result) => {
                                this.appToken = oauth2.accessToken.create(result);
                                var oathConfig = getOAuthConfig(node.id);
                                if (!oathConfig) {
                                    oathConfig = createOAuthConfig(node.id);
                                }
                                oathConfig.app = {
                                    token: this.appToken.token.access_token
                                }
                                storeOAuthConfig(node.id, oathConfig);
                                node.log(JSON.stringify(this.appToken));
                                if (statusNode) {
                                    statusNode.status({fill: "green", shape: "dot", text: "token available"});
                                }
                                resolve();
                            })
                            .catch((error) => {
                                node.error("Obtaining Access Token Failed: " + error.message, error);
                                reject(error);
                            });
                    });
                },
                onRenew: function(transition, statusNode) {
                	let tokenConfig = {};
                    return new Promise((resolve, reject) => {
                        oauth2.clientCredentials.getToken(tokenConfig)
                        .then((result) => {
                            this.appToken = oauth2.accessToken.create(result);
                            var oathConfig = getOAuthConfig(node.id);
                            if (!oathConfig) {
                                oathConfig = createOAuthConfig(node.id);
                            }
                            oathConfig.app = {
                                token: this.appToken.token.access_token
                            }
                            storeOAuthConfig(node.id, oathConfig);
                            node.log(JSON.stringify(this.appToken));
                            node.context().global.set(node.id, this);
                            if (statusNode) {
                                statusNode.status({fill: "green", shape: "dot", text: "token available"});
                            }
                            resolve(this.appToken);
                        })
                        .catch((error) => {
                            node.error("Access Token Renew Failed: " + error.message, error);
                            reject(error);
                            fsm.failed(statusNode);
                        });
                    });
                },
                onInvalidate: function(transition, statusNode) {
                    if (statusNode) {
                        statusNode.status({fill: "red", shape: "dot", text: "token expired"});
                    }
                },
                onFailed: function(transition, statusNode) {
                    if (statusNode) {
                        statusNode.status({fill: "grey", shape: "dot", text: "uninitialized token"});
                    }
                },
                getAccessToken: function() {
                    return this.appToken;
                }/*,
                onEnterHasToken: function() {
                    node.status({fill: "green", shape: "dot", text: "has token"});
                },
                onEnterTokenExpired: function() {
                    node.status({fill: "red", shape: "dot", text: "expired token"});
                },
                onEnterNoToken: function() {
                    node.status({fill: "grey", shape: "dot", text: "uninitialized token"});
                }*/
            }
        });
        this.getStateMachine = function() {
            return fsm;
        };
        this.verifyAccessToken = (accessToken, statusNode) => {
            if (accessToken.expired()) {
                fsm.invalidate(statusNode);
                fsm.renew(statusNode)
                .then((accessToken) => {
                    return accessToken;
                });
            } else {
                return accessToken;
            }
        };
        //OAuth Flow on behalf of the user
        this.getAuthorizationUrl = function(protocol, hostname, port) {
            let callbackUrl = protocol + '//' + hostname + (port ? ':' + port : '')
                + '/oauth2/node/' + this.id + '/auth/callback';
            let csrfToken = crypto.randomBytes(18).toString('base64').replace(/\//g, '-').replace(/\+/g, '_');
            RED.log.info(csrfToken);
            var callback = {
                callbackUrl: callbackUrl,
                state: csrfToken
            }
            var oathConfig = getOAuthConfig(node.id);
            if (!oathConfig) {
                oathConfig = createOAuthConfig(node.id);
            }
            if (oathConfig.user.callback) {
                oathConfig.user.callback=callback;
            } else {
                oathConfig.user = {
                    callback: callback
                }
            }
            storeOAuthConfig(node.id, oathConfig);
            node.log(JSON.stringify(oathConfig));
            return oauth2.authorizationCode.authorizeURL({
                client_id: credentials.client.id,
                redirect_uri: callbackUrl,
                scope: node.scope,
                state: csrfToken
            });
        };
        this.getUserAccessToken = (id) => {
            var oathConfig = getOAuthConfig(id);
            var token = {};
            if (oathConfig.user.token) {
                token = oathConfig.user.token;
            }
            return token;
        }

        node.getStateMachine().obtain();
    };
    RED.nodes.registerType("wws-credentials",WWSNode, {
        credentials: {
            clientId: {type: "text"},
            clientSecret: {type: "password"}
        }
    });
    //HTTP Endpoint to provide a redirect URL for callback
    RED.httpAdmin.get('/wws/app/:id/auth/url', (req, res) => {
        RED.log.log("/auth/url");
        
        if (!req.params.id || !req.query.protocol || !req.query.hostname) {
            res.sendStatus(400);
            return;
        }

        var accountConfig = RED.nodes.getNode(req.params.id);

        if (!node) {
            res.sendStatus(404);
            return;
        }

        res.send({
            'url': accountConfig.getAuthorizationUrl(req.query.protocol, req.query.hostname, req.query.port)
        });
    });
    //HTTP Endpoint to OAuth Callback URL
    RED.httpAdmin.get('/wws/app/:id/auth/callback', (req, res) => {
        if (!req.params.id) {
            res.sendStatus(400);
            return;
        }

        let node = RED.nodes.getNode(req.params.id);
        if (!node) {
            res.sendStatus(404);
            return;
        }
        var oathConfig = getOAuthConfig(req.params.id);
        var token = "";
        if (oathConfig) {
            token = oathConfig.user.callback.state;
        }
        if (token != req.query.state) {
            res.sendStatus(401);
            return;
        }
        var token = getUserToken(req.query.code, oathConfig.user.callback.callbackUrl);
        var oathConfig = getOAuthConfig(req.params.id);
        oathConfig.user.token = token;
        storeOAuthConfig(req.params.id, oathConfig);
        res.sendStatus(200);
    });

    // HTTP Endpoint to Get List of Spaces
    RED.httpAdmin.get('/wws/app/:id/spaces', RED.auth.needsPermission('wws.read'), function(req, res) {
        var accountConfig = RED.nodes.getNode(req.params.id);
        var oathConfig = getOAuthConfig(req.params.id);
        var bearerToken = oathConfig.app.token;
        var query = "query getSpaces { spaces(first: 50) { items { id title } } }";
        console.log(JSON.stringify(accountConfig));
        var host = accountConfig.api;

        function getSpaces(host, bearerToken, query) {
            var uri = host + "/graphql";
            var options = {
              method: "POST",
              uri: uri,
              headers: {
                Authorization: "Bearer " + bearerToken
              },
              json: true,
              body: {
                query: query
              }
            };
            console.log(options);
            return rp(options);
        }

        getSpaces(host, bearerToken, query).then((response) => {
            var spaces = response.data.spaces.items;
            console.log("SPACES: ", spaces);
            res.json(spaces);
          }).catch((err) => {
            console.log("Error while getting list of spaces.", err);
        });
    });
    // HTTP Endpoint to add the app photo
    RED.httpAdmin.post('/wws/app/:id/photo', (req, res) => {
        var accountConfig = RED.nodes.getNode(req.params.id);
        var oathConfig = getOAuthConfig(req.params.id);
        var bearerToken = oathConfig;

        var contentType = req.headers["content-type"];
        var contentLength = req.headers['content-length'];

        var canBeProcessed = (accountConfig && bearerToken)?true:false;

        function processRequest(buf) {
            var url = accountConfig.api + "/photos";
            
            //Do post message
            var opts = urllib.parse(url);
            opts.method = "POST";
            opts.headers = {
                "Content-Type": contentType,
                "Content-Length": contentLength,
                "Authorization": "Bearer " + bearerToken           
            };
            var responseBody = {};
            var wwsReq = ((/^https/.test(url))?https:http).request(opts,function(wwsRes) {
                wwsRes.setEncoding("utf8");
                wwsRes.on('data', (chunk) => {
                    
                    if (!Buffer.isBuffer(chunk)) {
                        responseBody = JSON.parse(chunk);
                        //Modify URL to have a full qualified URL
                        if (responseBody && responseBody.photoUrl) {
                            responseBody.photoUrl = accountConfig.api + responseBody.photoUrl
                        }
                        //Logging on Info Level
                        RED.log.info(JSON.stringify(responseBody));
                    }
                });
                wwsRes.on('end', () => {
                    switch (wwsRes.statusCode) {
                        case 415:
                            RED.log.error("Unsupported Media uploaded. Please use only JPG to upload the profile photo.");
                            break;
                        case 500:
                            RED.log.error("Server error occurred on POST attempt.");
                            break;
                        case 200:
                            break;

                    }
                    if (wwsRes.statusCode > 200) {
                        res.statusCode = 500;
                    } else {
                        res.statusCode = 200
                    }
                    res.end(JSON.stringify(responseBody));
                });
            });
            wwsReq.on("error", (e) => {
                RED.log.warn("Unsupported Media uploaded. Please use only JPG to upload the profile photo." + e.message);
            });
            // write data to request body
            wwsReq.write(buf);
            wwsReq.end();

        };
        getRawBody(req, {
            length: contentLength,
            limit: '200kb'
          })
        .then(function (buf) {
            if (canBeProcessed) {
                processRequest(buf);
            } else {
                throw new Error("The request could not be processed. Please check the Debug Tab for further information! ");
            }
        })
        .catch(function (err) {
            res.statusCode = 500
            res.end(err.message)
        })

    });
    function getOAuthConfig(id) {
        return RED.settings.get(id);
    }
    
    function createOAuthConfig(id) {
        var oathConfig = {};
        RED.settings.set(id, oauthConfig);
        return oauthConfig;
    }

    function storeOAuthConfig(id, oathConfig) {
        RED.settings.set(id, oauthConfig);
    }

    function getUserToken(code, redirectUrl) {
        let tokenConfig = {
            code: code,
            redirect_uri: redirectUrl
        };
        return new Promise((resolve, reject) => {
            oauth2.authorizationCode.getToken(tokenConfig)
                .then((result) => {
                    return oauth2.accessToken.create(result);
                    resolve();
                })
                .catch((error) => {
                    node.error('Obtaining Access Token Failed: ' + error.message, error);
                    reject(error);
                });
        });
    }
}