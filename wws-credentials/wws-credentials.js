module.exports = function(RED) {
    "use strict";
    const OAuth2 = require('simple-oauth2');
    const urllib = require("url");
    const http = require("follow-redirects").http;
    const https = require("follow-redirects").https;
    const getRawBody = require('raw-body');
    const crypto = require('crypto');
    const rp = require("request-promise-native");


    function WWSNode(config) {
        RED.nodes.createNode(this, config);

        this.accountName = config.accountName;
        this.name = config.accountName;
        this.clientId = config.clientId;
        this.clientSecret = config.clientSecret;

        /* Remove this for productive usage*/
        console.log("Credentials for [" + this.id + "] " + (this.accountName ? this.accountName : ""));
        console.log("=>" + JSON.stringify(this.credentials, "", 2));
        
        /*
        let stringOrDefault = (value, defaultValue) => {
            return typeof value == 'string' && value.length > 0 ? value : defaultValue;
        }
        this.api = config.api;
        this.tokenPath = stringOrDefault(config.tokenPath, undefined);
        this.revokePath = stringOrDefault(config.revokePath, undefined);
        this.authorizePath = stringOrDefault(config.authorizePath, undefined);
        this.tokenType = config.tokenType;
        
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
            data: {
                token:"",
                tokenType: tokenType
            },
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
                                oauthConfig.app = this.appToken;
                                storeOAuthConfig(node.id, oauthConfig);
                                if (statusNode) {
                                    statusNode.status({fill: "green", shape: "dot", text: "token available"});
                                }
                                resolve();
                            })
                            .catch((error) => {
                                node.error("Obtaining Access Token Failed: " + error.message, error);
                                if (statusNode) {
                                    statusNode.status({fill: "red", shape: "dot", text: "error"});
                                }
                                resolve();
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
                            oauthConfig.app = this.appToken;
                            storeOAuthConfig(node.id, oauthConfig);
                            node.log(JSON.stringify(this.appToken));
                            //TODO: Store in RED.settings.
                            node.context().global.set(node.id, this);
                            if (statusNode) {
                                statusNode.status({fill: "green", shape: "dot", text: "token available"});
                            }
                            resolve(this.appToken);
                        })
                        .catch((error) => {
                            node.error("Access Token Renew Failed: " + error.message, error);
                            done();
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
                RED.log.log("Access Token expired, renewing token...")
                fsm.invalidate(statusNode);
                fsm.renew(statusNode)
                .then((accessToken) => {
                    RED.log.log("Access Token expired, renewing token...")
                    return accessToken;
                })
                .catch((error) => {
                    RED.log.log("Renew access token failed. Reason: " + JSON.stringify(error));
                });
            } else {
                return accessToken;
            }
        };
        */
        this.on('close', function(removed, done) {
            RED.log.info("Close Event called");
            if (removed) {
                // This node has been deleted
                RED.log.info("Deleting node "+ this.name +"["+this.id+"] from persistent cache....");
                //Workaround as no remove(key) is exposed.
                var oauthConfig = undefined;
                storeOAuthConfig(this.id, oauthConfig);
            } else {
                // This node is being restarted
            }
            done();
        });
        /*
        this.getStateMachine().obtain();
        */
        this.getCredentials = () => {
            return {
                client: {
                    id: this.clientId,
                    secret: this.clientSecret
                },
                auth: {
                    tokenHost: this.credentials.api
                }
            };
        };
        this.getAccessToken = (statusNode) => {
            let accessToken = this.credentials.token;
            const oauth2 = OAuth2.create(this.getCredentials());
            let tokenHelper = oauth2.accessToken.create(accessToken);
            if (tokenHelper && tokenHelper.expired()) {
                if (statusNode) {
                    statusNode.status({fill: "yellow", shape: "dot", text: "token expired"});
                }
                console.log("Access Token expired, renewing token...")
                switch (this.credentials.tokenType) {
                    case "bot":
                        let tokenConfig = {};
                        oauth2.clientCredentials.getToken(tokenConfig)
                        .then((result) => {
                            let newToken = result;
                            let scopes = newToken.scope.trim().split(" ");
                            newToken.scope = scopes;
                            this.credentials.token = newToken;
                            if (statusNode) {
                                statusNode.status({fill: "green", shape: "dot", text: "token available"});
                            }
                            storeOAuthConfig(this.id, this.credentials);
                            return this.credentials.token;
                        })
                        .catch((error) => {
                            RED.log.error("Error: " + error.message);
                            console.log("Error: " + JSON.stringify(error));
                            if (statusNode) {
                                statusNode.status({fill: "grey", shape: "dot", text: "uninitialized token"});
                            }
                        });
                        break;
                    case "user":
                        tokenHelper.refresh()
                        .then((result) => {
                            let newToken = result.token;
                            let scopes = newToken.scope.trim().split(" ");
                            newToken.scope = scopes;
                            this.credentials.token = newToken;
                            if (statusNode) {
                                statusNode.status({fill: "green", shape: "dot", text: "token available"});
                            }
                            storeOAuthConfig(this.id, this.credentials);
                            return this.credentials.token;
                        })
                        .catch((error) => {
                            RED.log.error("Error: " + error.message);
                            console.log("Error: " + JSON.stringify(error));
                            if (statusNode) {
                                statusNode.status({fill: "grey", shape: "dot", text: "uninitialized token"});
                            }
                        });
                        break;
                    default:
                        if (statusNode) {
                            statusNode.status({fill: "red", shape: "dot", text: "unknown tokenType"});
                        }
                        break;
                }
            } else if (accessToken) {
                statusNode.status({fill: "green", shape: "dot", text: "token available"});
                return this.credentials.token;
            } else {
                statusNode.status({fill: "grey", shape: "dot", text: "token unavailable"});
            }
           
        };
        this.hasAccessToken = () => {
            return (this.credentials.token);
        }
        this.getApiUrl = () => {
            return this.credentials.api;
        }
    };
    RED.nodes.registerType("wws-credentials",WWSNode, {
        credentials: {
            api: {type:"text"},
            tokenType: {type:"text"},
            token: {type: "password"}
        }
    });
    
    // Http Endpoint to display token user
    RED.httpAdmin.get('/wws/app/:id/token', (req, res) => {
        var oauthConfig = getOAuthConfig(req.params.id);
        console.log("TEST: " + JSON.stringify(oauthConfig));
        if (oauthConfig && oauthConfig.token) {
            var token = oauthConfig.token;
            var body = {
                displayName: token.displayName,
                id: token.id,
                scope: token.scope
            }
            res.json(body);
        } else {
            res.sendStatus(404);
            return;
        }
    });
    // HTTP Endpoint to receive the name based on tokenType
    RED.httpAdmin.get('/wws/app/:id/name/:userId', RED.auth.needsPermission('wws.read'), function(req, res) {
        var oauthConfig = getOAuthConfig(req.params.id);
        RED.log.trace("/name: " + JSON.stringify(oauthConfig));
        var bearerToken;
        var host;
        if (oauthConfig && oauthConfig.token) {
            bearerToken = oauthConfig.token.access_token;
            host = oauthConfig.api;
        } else {
            RED.log.error("No token information could be found for Node " + req.params.id + "!");
            res.sendStatus(400);
            return;
        }
        var userId = req.params.userId;
        if (!userId) {
            RED.log.error("No user id could be found for Node " + req.params.id + "!");
            res.sendStatus(400);
            return;
        }
        RED.log.log("Token: " + bearerToken);
        RED.log.log("Host: " + host);
        
        var query = "query getDisplayName { person (id: \"" + userId + "\") { id displayName } }";
        RED.log.log("Query: " + query);

        function getDisplayName(host, bearerToken, query) {
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
            RED.log.log(JSON.stringify(options));
            return rp(options);
        }
        if (bearerToken && host) {
            getDisplayName(host, bearerToken, query).then((response) => {
                let userInformation = response.data.person;
                RED.log.log("UserInformation: ", JSON.stringify(userInformation));
                let displayName;
                switch (oauthConfig.tokenType) {
                    case "user":
                        displayName = userInformation.displayName + " (on behalf of " + oauthConfig.token.displayName + ")";
                        break;
                    default:
                    case "bot":
                        displayName = userInformation.displayName;
                        break
                }
                res.json({
                    appName: displayName
                });
              }).catch((err) => {
                RED.log.error("Error while reading the display name. Reason: " +  err.message);
                RED.log.log(JSON.stringify(err));
                let displayMessage = err.message;
                if (err.statusCode) {
                    switch (err.statusCode) {
                        case 401:
                            displayMessage = "Token is expired, please renew token!"
                            break;
                        default:
                            break;
                    }
                }
                res.json({
                    message: displayMessage,
                    error: err
                });
            });
        } else {
            res.json({
                error: "No bearerToken or Hostname have been provided!"
            });
        }

    });

    //HTTP Endpoint to provide a redirect URL for callback
    RED.httpAdmin.post('/wws/app/:id/auth/url', (req, res) => {
        RED.log.trace(JSON.stringify(req.body));
        RED.log.trace("ID: " + req.params.id);
        if (!req.params.id || !req.body.protocol || !req.body.hostname) {
            res.sendStatus(400);
            return;
        }
        var oauthConfig = getOAuthConfig(req.params.id);
        if (!oauthConfig || (oauthConfig && !oauthConfig.token)) {
            oauthConfig = createOAuthConfig(req.params.id);
        }
        var credentials;
        if (req.body.credentials && req.body.credentials.client && req.body.credentials.client.id && req.body.credentials.client.secret) {
            credentials = req.body.credentials;
        } else {
            res.sendStatus(400);
            return;
        }
        const oauth2 = OAuth2.create(credentials);
        switch (req.body.tokenType) {
            case "user":
                let callback = {
                    callbackUrl: req.body.protocol + '//' + req.body.hostname + (req.body.port ? ':' + req.body.port : '') + '/wws/app/' + req.params.id + '/auth/callback',
                    state: crypto.randomBytes(18).toString('base64').replace(/\//g, '-').replace(/\+/g, '_')
                }
                oauthConfig.callback = callback;
                oauthConfig.credentials = credentials;
                RED.log.log("OAuthConfig:" + JSON.stringify(oauthConfig));
                storeOAuthConfig(req.params.id, oauthConfig);
                var url = oauth2.authorizationCode.authorizeURL({
                    client_id: credentials.client.id,
                    redirect_uri: callback.callbackUrl,
                    state: callback.state
                })
                RED.log.log("Callback URL:" + url);
                res.send({
                    'url': url
                });
                break;
            default:
            case "bot":
                let tokenConfig = {};
                oauth2.clientCredentials.getToken(tokenConfig)
                .then((result) => {
                    RED.log.info("AccessToken:" + JSON.stringify(result));
                    var scopes = result.scope.trim().split(" ");
                    result.scope = scopes;
                    res.json(result);
                    oauthConfig.token = result;
                    oauthConfig.tokenType = req.body.tokenType;
                    oauthConfig.api = credentials.auth.tokenHost;

                    storeOAuthConfig(req.params.id, oauthConfig);
                })
                .catch((error) => {
                    RED.log.log("Error:" + JSON.stringify(error));
                    RED.log.error("Receiving Access Token failed: " + error.message);
                    res.sendStatus(error.status);
                });
                break;
        }
        
    });
    //HTTP Endpoint to OAuth Callback URL
    RED.httpAdmin.get('/wws/app/:id/auth/callback', (req, res) => {
        if (!req.params.id) {
            res.sendStatus(400);
            return;
        }

        var oauthConfig = getOAuthConfig(req.params.id);
        RED.log.trace("Outh after callback: " + JSON.stringify(oauthConfig));
        var state = "";
        if (oauthConfig && oauthConfig.callback) {
            state = oauthConfig.callback.state;
        } else {
            res.sendStatus(404);
            return;
        }
        if (state != req.query.state) {
            res.sendStatus(401);
            return;
        }
        getUserToken(oauthConfig.credentials, req.query.code, req.query.scope, oauthConfig.callback.callbackUrl)
        .then((response) => {
            var oauthConfig = getOAuthConfig(req.params.id);
            RED.log.info("User Token: " + JSON.stringify(response.token));
            var userToken = response.token;
            var scopes = userToken.scope.trim().split(" ");
            userToken.scope = scopes;
            oauthConfig.token = userToken;
            oauthConfig.tokenType = "user";
            oauthConfig.api = oauthConfig.credentials.auth.tokenHost;
            
            delete oauthConfig.callback;
            delete oauthConfig.credentials;
            storeOAuthConfig(req.params.id, oauthConfig);
            res.sendStatus(200);
        }).catch((failure) => {
            res.status(failure.status);
            res.json(failure);
        });
    });

    // Http Endpoint to remove the current token
    RED.httpAdmin.get('/wws/app/:id/remove', (req, res) => {
        var oauthConfig = getOAuthConfig(req.params.id);
        RED.log.trace("OAuthConfig: " + JSON.stringify(oauthConfig));
        if (oauthConfig && oauthConfig.token) {

            createOAuthConfig(req.params.id, oauthConfig.tokenType);
            res.status(200);
        } else {
            res.status(304);
        }
        res.json({
            oauthConfig: oauthConfig
        });
        return;
    });


    // HTTP Endpoint to Get List of Spaces
    RED.httpAdmin.get('/wws/app/:id/spaces', RED.auth.needsPermission('wws.read'), function(req, res) {
        var oauthConfig = getOAuthConfig(req.params.id);
        var bearerToken;
        var host;
        if (oauthConfig && oauthConfig.token) {
            bearerToken = oauthConfig.token.access_token;
            host = oauthConfig.api;
        }
        var query = "query getSpaces { spaces(first: 50) { items { id title } } }";
        

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
            RED.log.log(JSON.stringify(options));
            return rp(options);
        }
        if (bearerToken && host) {
            getSpaces(host, bearerToken, query).then((response) => {
                var spaces = response.data.spaces.items;
                RED.log.log("SPACES: ", JSON.stringify(spaces));
                res.json(spaces);
              }).catch((err) => {
                RED.log.log("Error while getting list of spaces.", err);
                res.json({
                    error: err
                });
            });
        } else {
            res.json({
                error: "No bearerToken or Hostname have been provided!"
            });
        }

    });
    // HTTP Endpoint to add the app photo
    RED.httpAdmin.post('/wws/app/:id/photo', (req, res) => {
        var oauthConfig = getOAuthConfig(req.params.id);
        var bearerToken;
        var host;
        if (oauthConfig && oauthConfig.token) {
            bearerToken = oauthConfig.token.access_token;
            host = oauthConfig.api;
        }
        var contentType = req.headers["content-type"];
        var contentLength = req.headers['content-length'];

        var canBeProcessed = (host && bearerToken)?true:false;

        function processRequest(buf) {
            var url = host + "/photos";
            
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
                            responseBody.photoUrl = oauthConfig.api + responseBody.photoUrl
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
        var oauthConfig = RED.nodes.getCredentials(id);
        if (!oauthConfig) {
            oauthConfig = RED.settings.get(id);
            if (oauthConfig) {
                //fallback - only log if used!
                RED.log.info("Using FALLBACK to receive oauthConfig " + JSON.stringify(oauthConfig));

            }
        }
        if (!oauthConfig) {
            oauthConfig = undefined;
        }
        return oauthConfig;
    }
    
    function createOAuthConfig(id, tokenType) {
        if (!tokenType) {
            tokenType = "bot";
        }
        var oauthConfig = {
            tokenType : tokenType
        };
        RED.settings.set(id, oauthConfig);
        RED.nodes.addCredentials(id, oauthConfig);
        return oauthConfig;
    }

    function storeOAuthConfig(id, oauthConfig) {
        RED.log.info("Storing => " + JSON.stringify(oauthConfig));
        RED.settings.set(id, oauthConfig);
        RED.nodes.addCredentials(id, oauthConfig);
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
    /*
    function createStateMachine(credentials, tokenType, tokenConfig) {
        var fsm = new StateMachine({
            init: 'no_token',
            transitions: [
                { name: 'obtain', from: 'no_token', to: 'has_token' },
                { name: 'invalidate', from: 'has_token', to: 'token_expired' },
                { name: 'renew', from: 'token_expired', to: 'has_token' },
                { name: 'failed', from: 'token_expired', to: 'no_token' }
            ],
            data: {
                    credentials: credentials,
                    token:"",
                    tokenConfig: tokenConfig,
                    tokenType: tokenType
            },
            methods: {
                initOAuthService: () => {
                    return OAuth2.create(this.credentials);
                },
                onObtain: function(transition, statusNode) {
                    const oauth2 = this.initOAuthService();
                    if (this.tokenType === "user") {
                        return new Promise((resolve, reject) => {
                            oauth2.authorizationCode.getToken(tokenConfig)
                                .then((result) => {
                                    this.token = oauth2.accessToken.create(result);
                                    resolve(token);
                                })
                                .catch((error) => {
                                    RED.log.error('Obtaining Access Token Failed: ' + error.message, error);
                                    reject(error);
                                });
                        }); 
                    } else {
                        return new Promise((resolve, reject) => {
                            oauth2.clientCredentials.getToken(tokenConfig)
                                .then((result) => {
                                    this.token = oauth2.accessToken.create(result);
                                    if (statusNode) {
                                        statusNode.status({fill: "green", shape: "dot", text: "token available"});
                                    }
                                    resolve(this.token);
                                })
                                .catch((error) => {
                                    RED.log.error("Obtaining Access Token Failed: " + error.message, error);
                                    if (statusNode) {
                                        statusNode.status({fill: "red", shape: "dot", text: "error"});
                                    }
                                    reject(error);
                                });
                        });
                    }
                },
                onRenew: function(transition, statusNode) {
                    const oauth2 = this.initOAuthService();
                    if (this.tokenType === "user") {
                        return new Promise(() => {
                            try {
                                this.token = this.token.refresh();
                                resolve(this.token);
                            } catch (error) {
                                RED.log.error("Obtaining Access Token Failed: " + error.message, error);
                                if (statusNode) {
                                    statusNode.status({fill: "red", shape: "dot", text: "error"});
                                }
                                reject(error);
                            }
                        });
                    } else {
                        return new Promise((resolve, reject) => {
                            oauth2.clientCredentials.getToken(this.tokenConfig)
                            .then((result) => {
                                this.token = oauth2.accessToken.create(result);
                                if (statusNode) {
                                    statusNode.status({fill: "green", shape: "dot", text: "token available"});
                                }
                                resolve(this.appToken);
                            })
                            .catch((error) => {
                                RED.log.error("Obtaining Access Token Failed: " + error.message, error);
                                if (statusNode) {
                                    statusNode.status({fill: "red", shape: "dot", text: "error"});
                                }
                                reject(error);
                            });
                        });
                    }
                },
                onInvalidate: function(transition, statusNode) {
                    this.token="";
                    if (statusNode) {
                        statusNode.status({fill: "red", shape: "dot", text: "token expired"});
                    }
                },
                onFailed: function(transition, statusNode) {
                    this.token="";
                    if (statusNode) {
                        statusNode.status({fill: "grey", shape: "dot", text: "uninitialized token"});
                    }
                }
            }
        });
        return fsm;
    }
    */
}