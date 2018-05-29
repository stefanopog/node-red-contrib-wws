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
        this.name = config.accountName;
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

        const node = this;
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
        var oauthConfig = getOAuthConfig(this.id);
        if (!oauthConfig) {
            RED.log.info("Creating new oauthConfig");
            createOAuthConfig(this.id);
            oauthConfig = getOAuthConfig(this.id);
        }
        if (!oauthConfig.credentials) {
            oauthConfig.credentials = credentials;
            storeOAuthConfig(node.id, oauthConfig);
        }
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
                                var oauthConfig = getOAuthConfig(node.id);
                                if (!oauthConfig) {
                                    oauthConfig = createOAuthConfig(node.id);
                                }
                                oauthConfig.app = {
                                    token: this.appToken.token.access_token
                                }
                                storeOAuthConfig(node.id, oauthConfig);
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
                            var oauthConfig = getOAuthConfig(node.id);
                            if (!oauthConfig) {
                                oauthConfig = createOAuthConfig(node.id);
                            }
                            oauthConfig.app = {
                                token: this.appToken.token.access_token
                            }
                            storeOAuthConfig(node.id, oauthConfig);
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
                }
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
        this.getAuthorizationUrl = function(protocol, hostname, port, scope) {
            let callback = {
                callbackUrl: protocol + '//' + hostname + (port ? ':' + port : '') + '/wws/app/' + this.id + '/auth/callback',
                scope: scope,
                state: crypto.randomBytes(18).toString('base64').replace(/\//g, '-').replace(/\+/g, '_')
            }
            var oauthConfig = getOAuthConfig(this.id);
            if (!oauthConfig) {
                return;
            }
            oauthConfig.callback=callback;
            let credentials = oauthConfig.credentials;
            storeOAuthConfig(this.id, oauthConfig);
            return oauth2.authorizationCode.authorizeURL({
                client_id: credentials.client.id,
                redirect_uri: callback.callbackUrl,
                scope: callback.scope,
                state: callback.state
            });
        };
        this.on('close', function(removed, done) {
            RED.log.info("Close Event called");
            if (removed) {
                // This node has been deleted
                RED.log.info("Deleting node "+ this.name +"["+this.id+"] from persistent cache....");
                //Workaround as no remove(key) is exposed.
                var oauthConfig = {};
                storeOAuthConfig(this.id, oauthConfig);
            } else {
                // This node is being restarted
                //TODO: stop any active polling!

            }
            done();
        });
        node.getStateMachine().obtain();
    };
    RED.nodes.registerType("wws-credentials",WWSNode, {
        credentials: {
            clientId: {type: "text"},
            clientSecret: {type: "password"}
        }
    });

    /*
    // Http Endpoint to display token user
    RED.httpAdmin.get('/wws/app/:id/user/:user/remove', (req, res) => {
        var oauthConfig = getOAuthConfig(req.params.id);
        delete  oauthConfig.user;
        if (oauthConfig.deleteUser(req.params.user)) {
            RED.log.info("User " + req.params.user + " successfully revoked!" );
        } else {
            RED.log.info("Could not revoke user " + req.params.user + ". Not found!" );
        }
        storeOAuthConfig(req.params.id, oauthConfig);
        if (oauthConfig.user.token) {
            res.sendStatus(200);
        } else {
            res.sendStatus(404);
            return;
        }
    });
    */

    // Http Endpoint to display token user
    RED.httpAdmin.get('/wws/app/:id/user', (req, res) => {
        var oauthConfig = getOAuthConfig(req.params.id);
        console.log(JSON.stringify(oauthConfig.user.token));
        if (oauthConfig && oauthConfig.user && oauthConfig.user.token) {
            var token = oauthConfig.user.token;
            var body = {
                displayName: token.displayName,
                userId: token.id,
                scope: token.scope.trim().split(" ")
            }
            console.log(JSON.stringify(body));
            res.json(body);
        } else {
            res.sendStatus(404);
            return;
        }
    });
    //HTTP Endpoint to provide a redirect URL for callback
    RED.httpAdmin.get('/wws/app/:id/auth/url', (req, res) => {
        RED.log.log("/auth/url");
        
        if (!req.params.id || !req.query.protocol || !req.query.hostname) {
            res.sendStatus(400);
            return;
        }
        var scope = "";
        if (req.query.scope) {
            scope = req.query.scope;
            RED.log.log("Requested scope:" + scope);
        }
        var node = RED.nodes.getNode(req.params.id);

        if (!node) {
            res.sendStatus(404);
            return;
        }

        res.send({
            'url': node.getAuthorizationUrl(req.query.protocol, req.query.hostname, req.query.port, scope)
        });
    });
    //HTTP Endpoint to OAuth Callback URL
    RED.httpAdmin.get('/wws/app/:id/auth/callback', (req, res) => {
        if (!req.params.id) {
            res.sendStatus(400);
            return;
        }

        var oauthConfig = getOAuthConfig(req.params.id);
        var token = "";
        if (oauthConfig) {
            token = oauthConfig.callback.state;
        } else {
            res.sendStatus(404);
            return;
        }
        if (token != req.query.state) {
            res.sendStatus(401);
            return;
        }
        getUserToken(oauthConfig.credentials, req.query.code, req.query.scope, oauthConfig.callback.callbackUrl)
        .then((response) => {
            var oauthConfig = getOAuthConfig(req.params.id);
            RED.log.info("User Token: " + JSON.stringify(response.token));
            oauthConfig.user = {
                token: response.token
            };
            storeOAuthConfig(req.params.id, oauthConfig);
            res.sendStatus(200);
        }).catch((failure) => {
            res.status(failure.status);
            res.json(failure);
        });
    });

    // HTTP Endpoint to Get List of Spaces
    RED.httpAdmin.get('/wws/app/:id/spaces', RED.auth.needsPermission('wws.read'), function(req, res) {
        var accountConfig = RED.nodes.getNode(req.params.id);
        var oauthConfig = getOAuthConfig(req.params.id);
        var bearerToken = oauthConfig.app.token;
        var query = "query getSpaces { spaces(first: 50) { items { id title } } }";
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
        var oauthConfig = getOAuthConfig(req.params.id);
        var bearerToken;
        if (oauthConfig.user && oauthConfig.user.token) {
            bearerToken = oauthConfig.user.token.access_token;
        }
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
        var oauthConfig = RED.settings.get(id);
        if (!oauthConfig) {
            oauthConfig = undefined;
        }
        return oauthConfig;
    }
    
    function createOAuthConfig(id) {
        var oauthConfig = {};
        RED.settings.set(id, oauthConfig);
        return oauthConfig;
    }

    function storeOAuthConfig(id, oauthConfig) {
        RED.log.info(JSON.stringify(oauthConfig));
        RED.settings.set(id, oauthConfig);
    }

    function getUserToken(credentials, code, scope, redirectUrl) {
        const oauth2 = OAuth2.create(credentials);
        let tokenConfig = {
            code: code,
            scope: scope,
            redirect_uri: redirectUrl
        };
        return new Promise((resolve, reject) => {
            oauth2.authorizationCode.getToken(tokenConfig)
                .then((result) => {
                    var token = oauth2.accessToken.create(result);
                    resolve(token);
                })
                .catch((error) => {
                    RED.log.error('Obtaining Access Token Failed: ' + error.message, error);
                    reject(error);
                });
        });
    }
}