define(function(require) {
	var $ = require('jquery'),
		_ = require('lodash'),
		monster = require('monster');

	var appSubmodules = [
		'alerts'
	];

	require(_.map(appSubmodules, function(name) {
		return './submodules/' + name + '/' + name;
	}));

	var app = {
		name: 'core',

		subModules: appSubmodules,

		css: [ 'app' ],

		i18n: {
			'de-DE': { customCss: false },
			'en-US': { customCss: false },
			'fr-FR': { customCss: false },
			'ru-RU': { customCss: false }
		},

		requests: {},

		subscribe: {
			'core.loadApps': '_loadApps',
			'core.showAppName': 'showAppName',
			'core.triggerMasquerading': 'triggerMasquerading',
			'core.restoreMasquerading': 'restoreMasquerading',
			'core.initializeShortcuts': 'initializeShortcuts',
			'socket.connected': 'refreshIfWebSocketsApp',
			'socket.disconnected': 'onSocketDisconnected',
			'core.showWarningDisconnectedSockets': 'showWarningSockets',
			'core.hideTopbarDropdowns': 'hideTopbarDropdowns'
		},

		//Default app to render if the user is logged in, can be changed by setting a default app
		_defaultApp: 'appstore',

		spinner: {},

		// Global var to determine if there is a request in progress
		request: {
			active: false,
			counter: 0
		},

		appFlags: {},

		load: function(callback) {
			var self = this;

			self.callApi({
				resource: 'whitelabel.getByDomain',
				data: {
					domain: window.location.hostname,
					generateError: false
				},
				success: function(data) {
					callback(self);
				},
				error: function(err) {
					callback(self);
				}
			});
		},

		render: function(container) {
			var self = this,
				urlVars = monster.util.getUrlVars(),
				dataTemplate = {
					hidePowered: monster.config.whitelabel.hide_powered,
					jiraFeedback: {
						enabled: monster.config.whitelabel.hasOwnProperty('jiraFeedback') && monster.config.whitelabel.jiraFeedback.enabled === true,
						url: monster.config.whitelabel.hasOwnProperty('jiraFeedback') ? monster.config.whitelabel.jiraFeedback.url : ''
					},
					useDropdownApploader: monster.config.whitelabel.useDropdownApploader
				},
				mainTemplate = $(self.getTemplate({
					name: 'app',
					data: dataTemplate
				}));

			document.title = monster.config.whitelabel.applicationTitle;

			self.checkURLVars(urlVars);

			self.loadAdditionalStyles();
			self.bindEvents(mainTemplate);
			self.displayVersion(mainTemplate);
			self.displayLogo(mainTemplate);
			self.displayFavicon();
			self.loadSVG();

			container.append(mainTemplate);

			self.loadAuth(); // do this here because subsequent apps are dependent upon core layout
			self.startSocket();
			self.startWebphone();
		},

		loadSVG: function() {
			var self = this,
				svgTemplate = $(self.getTemplate({
					name: 'svg-container'
				}));

			$('.core-wrapper').append(svgTemplate);
		},

		// We need the whitelabel profile to be loaded to execute this, that's why it's in core and not in monster directly
		loadAdditionalStyles: function() {
			var self = this;

			_.each(monster.config.whitelabel.additionalCss, function(path) {
				monster.css('css/' + path);
			});
		},

		checkURLVars: function(urlVars) {
			var self = this;

			// In dashboard mode we want to disable the logout timer, and also remove some css elements
			if (urlVars.hasOwnProperty('view') && urlVars.view === 'dashboard') {
				$('.core-wrapper').addClass('dashboard');
				monster.config.whitelabel.logoutTimer = 0;
			}
		},

		startSocket: function() {
			var self = this;

			monster.socket.connect();
		},

		startWebphone: function() {
			var self = this;

			monster.webphone.init();
		},

		loadAuth: function() {
			var self = this;

			monster.apps.load('auth', function(app) {
				app.render($('#monster_content'));
			});
		},

		showAppName: function(appName) {
			var self = this,
				navbar = $('.core-topbar'),
				currentApp = navbar.find('#main_topbar_current_app'),
				defaultApp;

			if (appName === 'myaccount') {
				var myaccount = {
					name: appName,
					label: self.i18n.active().controlCenter
				};

				myaccount.icon = monster.util.getAppIconPath(myaccount);

				monster.ui.formatIconApp(myaccount);

				if (currentApp.is(':empty')) {
					currentApp
						.append($(self.getTemplate({
							name: 'current-app',
							data: myaccount
						})));

					navbar
						.find('#main_topbar_current_app_name')
						.data('originalName', 'appstore');

					navbar.find('#main_topbar_current_app_name').fadeIn(100);
				} else {
					var originalName = navbar.find('#main_topbar_current_app_name').data('name');

					navbar.find('#main_topbar_current_app_name').fadeOut(100, function() {
						currentApp
							.empty()
							.append($(self.getTemplate({
								name: 'current-app',
								data: myaccount
							})));

						navbar
							.find('#main_topbar_current_app_name')
							.data('originalName', originalName);

						navbar.find('#main_topbar_current_app_name').fadeIn(100);
					});
				}
			} else {
				_.each(monster.apps.auth.installedApps, function(val) {
					if (val.name === appName) {
						defaultApp = val;
						defaultApp.icon = monster.util.getAppIconPath(val);
					}
				});

				monster.ui.formatIconApp(defaultApp);

				if (appName === 'appstore') {
					currentApp.empty();
				} else if (currentApp.is(':empty')) {
					currentApp
						.append($(self.getTemplate({
							name: 'current-app',
							data: defaultApp
						})));

					navbar.find('#main_topbar_current_app_name').fadeIn(100);
				} else {
					navbar.find('#main_topbar_current_app_name').fadeOut(100, function() {
						currentApp
							.empty()
							.append($(self.getTemplate({
								name: 'current-app',
								data: defaultApp
							})));

						navbar.find('#main_topbar_current_app_name').fadeIn(100);
					});
				}
			}
		},

		initializeBaseApps: function() {
			var self = this,
				baseApps = ['apploader', 'appstore', 'myaccount', 'common'];

			if (monster.config.whitelabel.hasOwnProperty('additionalLoggedInApps')) {
				baseApps = baseApps.concat(monster.config.whitelabel.additionalLoggedInApps);
			}

			self.appFlags.baseApps = baseApps;
		},

		_loadApps: function(args) {
			var self = this;

			if (!self.appFlags.hasOwnProperty('baseApps')) {
				self.initializeBaseApps();
			}

			if (!self.appFlags.baseApps.length) {
				/* If admin with no app, go to app store, otherwise, oh well... */
				var defaultApp = monster.apps.auth.currentUser.priv_level === 'admin' ? args.defaultApp || self._defaultApp : args.defaultApp;

				// Now that the user information is loaded properly, check if we tried to force the load of an app via URL.
				monster.routing.parseHash();

				// If there wasn't any match, trigger the default app
				if (!monster.routing.hasMatch()) {
					if (typeof defaultApp !== 'undefined') {
						monster.apps.load(defaultApp, function(app) {
							monster.pub('core.alerts.refresh');
							self.showAppName(defaultApp);
							app.render($('#monster_content'));
						}, {}, true);
					} else {
						console.warn('Current user doesn\'t have a default app');
					}
				}
			} else {
				var appName = self.appFlags.baseApps.pop();

				monster.apps.load(appName, function() {
					self._loadApps(args);
				});
			}
		},

		bindEvents: function(container) {
			var self = this,
				spinner = container.find('.loading-wrapper');

			window.onerror = function(message, fileName, lineNumber, columnNumber, error) {
				monster.error('js', {
					message: message,
					fileName: fileName,
					lineNumber: lineNumber,
					columnNumber: columnNumber || '',
					error: error || {}
				});
			};

			/* Only subscribe to the requestStart and End event when the spinner is loaded */
			monster.sub('monster.requestStart', function(params) {
				self.onRequestStart(_.merge({
					spinner: spinner
				}, params));
			});

			monster.sub('monster.requestEnd', function(params) {
				self.onRequestEnd(_.merge({
					spinner: spinner
				}, params));
			});

			// Hide dropdowns when clicking anywhere outside the topbar nav links
			$(document).on('click',
				_.throttle(function(e) {
					if ($(e.target).closest('#main_topbar_nav').length > 0) {
						return;
					}
					e.stopPropagation();
					self.hideTopbarDropdowns();
				}, 250));

			// Hide dropdowns on click at any topbar link
			container.find('.core-topbar .links').on('click', function() {
				self.hideTopbarDropdowns({ except: $(this).attr('id') });
			});

			// Different functionality depending on whether default apploader or dropdown apploader to be opened
			var eventType = monster.config.whitelabel.useDropdownApploader ? 'mouseover' : 'click';
			container.find('#main_topbar_apploader_link').on(eventType, function(e) {
				e.preventDefault();
				monster.pub('apploader.toggle');
			});

			container.find('#main_topbar_account_toggle_link').on('click', function(e) {
				e.preventDefault();
				self.toggleAccountToggle();
			});

			container.find('#main_topbar_account_toggle').on('click', '.home-account-link', function() {
				self.restoreMasquerading({
					callback: function() {
						var currentApp = monster.apps.getActiveApp();
						if (currentApp in monster.apps) {
							monster.apps[currentApp].render();
						}
						self.hideAccountToggle();
					}
				});
			});

			container.find('#main_topbar_account_toggle').on('click', '.current-account-container', function() {
				var $this = $(this);

				if ($this.attr('data-id') !== monster.apps.auth.currentAccount.id) {
					self.triggerMasquerading({
						account: {
							id: $this.attr('data-id'),
							name: $this.text()
						},
						callback: function() {
							var currentApp = monster.apps.getActiveApp();
							if (currentApp in monster.apps) {
								if (monster.apps[currentApp].isMasqueradable) {
									monster.apps[currentApp].render();
								} else {
									monster.ui.toast({
										type: 'warning',
										message: self.i18n.active().noMasqueradingAllowed
									});
									monster.apps.apploader.render();
								}
							}
							self.hideAccountToggle();
						}
					});
				}
			});

			container.find('#main_topbar_signout_link').on('click', function() {
				monster.pub('auth.clickLogout');
			});

			container.find('#main_topbar_current_app').on('click', function() {
				var appName = $(this).find('#main_topbar_current_app_name').data('name');

				if (appName === 'myaccount') {
					monster.apps.load(appName, function(app) {
						app.renderDropdown(false);
					});
				} else {
					monster.apps.load(appName, function(app) {
						app.render();
					});
				}
			});

			container.find('#main_topbar_brand').on('click', function() {
				var appName = monster.apps.auth.defaultApp;

				if (appName) {
					monster.pub('myaccount.hide');
					monster.apps.load(appName, function(app) {
						self.showAppName(appName);
						app.render();
					});
				}
			});

			if (monster.config.whitelabel.hasOwnProperty('nav')) {
				if (monster.config.whitelabel.nav.hasOwnProperty('logout') && monster.config.whitelabel.nav.logout.length > 0) {
					container
						.find('#main_topbar_signout_link')
							.unbind('click')
							.attr('href', monster.config.whitelabel.nav.logout);
				}
			}

			container.find('[data-toggle="tooltip"]').tooltip();
		},

		hideAccountToggle: function() {
			$('#main_topbar_account_toggle_container .account-toggle-content').empty();
			$('#main_topbar_account_toggle_container .current-account-container').empty();
			$('#main_topbar_account_toggle').removeClass('open');
		},

		showAccountToggle: function() {
			var self = this,
				mainContainer = $('#main_topbar_account_toggle_container');

			monster.pub('common.accountBrowser.render', {
				container: mainContainer.find('.account-toggle-content'),
				customClass: 'ab-dropdown',
				addBackButton: true,
				allowBackOnMasquerading: true,
				onSearch: function(searchValue) {
					if (searchValue) {
						var template = $(self.getTemplate({
							name: 'accountToggle-search',
							data: {
								searchValue: searchValue
							}
						}));

						mainContainer.find('.current-account-container').html(template);
					} else {
						mainContainer.find('.current-account-container').html(monster.apps.auth.currentAccount.name).attr('data-id', monster.apps.auth.currentAccount.id);
					}
				},
				onAccountClick: function(accountId, accountName) {
					self.callApi({
						resource: 'account.get',
						data: {
							accountId: accountId
						},
						success: function(data, status) {
							self.triggerMasquerading({
								account: data.data,
								callback: function() {
									var currentApp = monster.apps.getActiveApp();
									if (currentApp in monster.apps) {
										if (monster.apps[currentApp].isMasqueradable) {
											monster.apps[currentApp].render();
										} else {
											monster.ui.toast({
												type: 'warning',
												message: self.i18n.active().noMasqueradingAllowed
											});
											monster.apps.apploader.render();
										}
									}
									self.hideAccountToggle();
								}
							});
						}
					});
				},
				onChildrenClick: function(data) {
					mainContainer.find('.current-account-container').html(data.parentName).attr('data-id', data.parentId);
				},
				onBackToParentClick: function(data) {
					mainContainer.find('.current-account-container').html(data.parentName).attr('data-id', data.parentId);
				},
				callback: function(data) {
					mainContainer.find('.current-account-container').html(monster.apps.auth.currentAccount.name).attr('data-id', monster.apps.auth.currentAccount.id);
				}
			});
			$('#main_topbar_account_toggle').addClass('open');
		},

		toggleAccountToggle: function() {
			var self = this;
			if ($('#main_topbar_account_toggle').hasClass('open')) {
				self.hideAccountToggle();
			} else {
				self.showAccountToggle();
			}
		},

		triggerMasquerading: function(args) {
			var self = this,
				account = args.account,
				callback = args.callback,
				afterGetData = function(account) {
					monster.apps.auth.currentAccount = $.extend(true, {}, account);
					self.updateApps(account.id);

					monster.pub('myaccount.renderNavLinks', {
						name: account.name,
						isMasquerading: true
					});
					$('#main_topbar_account_toggle').addClass('masquerading');

					monster.ui.toast({
						type: 'info',
						message: self.getTemplate({
							name: '!' + self.i18n.active().triggerMasquerading,
							data: {
								accountName: account.name
							}
						})
					});

					monster.pub('core.changedAccount');

					callback && callback();
				};

			if (args.account.id === monster.apps.auth.originalAccount.id) {
				self.restoreMasquerading({
					callback: callback
				});
			} else if (!args.account.hasOwnProperty('name')) {
				self.callApi({
					resource: 'account.get',
					data: {
						accountId: account.id,
						generateError: false
					},
					success: function(data, status) {
						account = data.data;

						afterGetData(account);
					},
					error: function() {
						// If we couldn't get the account, the id must have been wrong, we just continue with the original callback
						callback && callback();
					}
				});
			} else {
				afterGetData(args.account);
			}
		},

		updateApps: function(accountId) {
			$.each(monster.apps, function(key, val) {
				if (val.hasOwnProperty('isMasqueradable') ? val.isMasqueradable : true) {
					val.accountId = accountId;
				}
			});
		},

		restoreMasquerading: function(args) {
			var self = this,
				callback = args.callback;

			monster.apps.auth.currentAccount = $.extend(true, {}, monster.apps.auth.originalAccount);
			self.updateApps(monster.apps.auth.originalAccount.id);

			monster.pub('myaccount.renderNavLinks');
			$('#main_topbar_account_toggle').removeClass('masquerading');

			monster.ui.toast({
				type: 'info',
				message: self.i18n.active().restoreMasquerading
			});

			monster.pub('core.changedAccount');

			callback && callback();
		},

		/* Had to update that code because mainTemplate is no longer the main container, it's an array of divs, where one of them is the core-footer,
			so we look through that array and once we found it we add the version */
		displayVersion: function(mainTemplate) {
			var self = this,
				version = monster.util.getVersion(),
				container,
				$potentialContainer;

			_.each(mainTemplate, function(potentialContainer) {
				$potentialContainer = $(potentialContainer);

				if ($potentialContainer.hasClass('core-footer')) {
					container = $potentialContainer;
				}
			});

			if (container) {
				container.find('.tag-version').html('(' + version + ')');
			}
		},

		displayLogo: function(container) {
			var self = this,
				domain = window.location.hostname,
				apiUrl = monster.config.api.default,
				fillLogo = function(url) {
					var formattedURL = url.indexOf('src/') === 0 ? url.substr(4, url.length) : url;
					container.find('#main_topbar_brand').css('background-image', 'url(' + formattedURL + ')');
				};

			self.callApi({
				resource: 'whitelabel.getLogoByDomain',
				data: {
					domain: domain,
					generateError: false,
					dataType: '*'
				},
				success: function(_data) {
					fillLogo(apiUrl + 'whitelabel/' + domain + '/logo?_=' + new Date().getTime());
				},
				error: function(error) {
					if (monster.config.whitelabel.hasOwnProperty('logoPath') && monster.config.whitelabel.logoPath.length) {
						fillLogo(monster.config.whitelabel.logoPath);
					} else {
						fillLogo('apps/core/style/static/images/logo.svg');
					}
				}
			});
		},

		displayFavicon: function() {
			var self = this,
				domain = window.location.hostname,
				apiUrl = monster.config.api.default,
				changeFavIcon = function(src) {
					var link = document.createElement('link'),
						oldLink = document.getElementById('dynamicFavicon');

					link.id = 'dynamicFavicon';
					link.rel = 'shortcut icon';
					link.href = src;

					if (oldLink) {
						document.head.removeChild(oldLink);
					}

					document.head.appendChild(link);
				};

			self.callApi({
				resource: 'whitelabel.getIconByDomain',
				data: {
					domain: domain,
					generateError: false,
					dataType: '*'
				},
				success: function(_data) {
					var src = apiUrl + 'whitelabel/' + domain + '/icon?_=' + new Date().getTime();
					changeFavIcon(src);
				},
				error: function(error) {
					var src = 'apps/core/style/static/images/favicon.png';
					changeFavIcon(src);
				}
			});
		},

		onRequestStart: function(args) {
			var self = this,
				waitTime = 250,
				$spinner = args.spinner,
				bypassProgressIndicator = _.get(args, 'bypassProgressIndicator', false);

			// If indicated, bypass progress indicator display/hide process
			if (bypassProgressIndicator) {
				return;
			}

			self.request.counter++;

			// If we start a request, we cancel any existing timeout that was checking if the loading was over
			clearTimeout(self.spinner.endTimeout);

			if (self.request.counter) {
				self.request.active = true;
			}

			// And we start a timeout that will check if there are still some active requests after %waitTime%.
			// If yes, it will then show the spinner. We do this to avoid showing the spinner to often, and just show it on long requests.
			self.spinner.startTimeout = setTimeout(function() {
				if (self.request.counter && !$spinner.hasClass('active')) {
					$spinner.addClass('active');
				}

				clearTimeout(self.spinner.startTimeout);
			}, waitTime);
		},

		onRequestEnd: function(args) {
			var self = this,
				waitTime = 50,
				$spinner = args.spinner,
				bypassProgressIndicator = _.get(args, 'bypassProgressIndicator', false);

			// If indicated, bypass progress indicator display/hide process
			if (bypassProgressIndicator) {
				return;
			}

			self.request.counter--;

			// If there are no active requests, we set a timeout that will check again after %waitTime%
			// If there are no active requests after the timeout, then we can safely remove the spinner.
			// We do this to avoid showing and hiding the spinner too quickly
			if (!self.request.counter) {
				self.request.active = false;

				self.spinner.endTimeout = setTimeout(function() {
					if ($spinner.hasClass('active')) {
						$spinner.removeClass('active');
					}

					clearTimeout(self.spinner.startTimeout);
					clearTimeout(self.spinner.endTimeout);
				}, waitTime);
			}
		},

		initializeShortcuts: function(apps) {
			var self = this,
				shortcuts = [
					{
						category: 'general',
						key: '?',
						title: self.i18n.active().globalShortcuts.keys['?'].title,
						callback: function() {
							self.showShortcutsPopup();
						}
					},
					{
						category: 'general',
						key: '@',
						title: self.i18n.active().globalShortcuts.keys['@'].title,
						callback: function() {
							monster.pub('myaccount.renderDropdown');
						}
					},
					{
						adminOnly: true,
						category: 'general',
						key: 'a',
						title: self.i18n.active().globalShortcuts.keys.a.title,
						callback: function() {
							self.toggleAccountToggle();
						}
					},
					{
						adminOnly: true,
						category: 'general',
						key: 'shift+m',
						title: self.i18n.active().globalShortcuts.keys['shift+m'].title,
						callback: function() {
							self.restoreMasquerading({
								callback: function() {
									var currentApp = monster.apps.getActiveApp();
									if (currentApp in monster.apps) {
										monster.apps[currentApp].render();
									}
									self.hideAccountToggle();
								}
							});
						}
					},
					{
						adminOnly: true,
						category: 'general',
						key: 'shift+s',
						title: self.i18n.active().globalShortcuts.keys['shift+s'].title,
						callback: function() {
							monster.util.protectSensitivePhoneNumbers();
						}
					},
					{
						category: 'general',
						key: 'd',
						title: self.i18n.active().globalShortcuts.keys.d.title,
						callback: function() {
							self.showDebugPopup();
						}
					},
					{
						category: 'general',
						key: 'r',
						title: self.i18n.active().globalShortcuts.keys.r.title,
						callback: function() {
							monster.routing.goTo('apps/' + monster.apps.getActiveApp());
						}
					},
					{
						category: 'general',
						key: 'shift+l',
						title: self.i18n.active().globalShortcuts.keys['shift+l'].title,
						callback: function() {
							monster.pub('auth.logout');
						}
					}
				];

			if (!monster.config.whitelabel.hasOwnProperty('useDropdownApploader') || monster.config.whitelabel.useDropdownApploader === false) {
				shortcuts.push({
					category: 'general',
					key: '#',
					title: self.i18n.active().globalShortcuts.keys['#'].title,
					callback: function() {
						monster.pub('apploader.toggle');
					}
				});
			}

			_.each(shortcuts, function(shortcut) {
				monster.ui.addShortcut(shortcut);
			});

			self.addShortcutsGoToApps(apps);
		},

		showDebugPopup: function() {
			var self = this,
				acc = monster.apps.auth.currentAccount;

			if (!$('.debug-dialog').length) {
				var dataTemplate = {
						account: acc,
						authToken: self.getAuthToken(),
						apiUrl: self.apiUrl,
						version: monster.util.getVersion(),
						hideURLs: monster.util.isWhitelabeling() && !monster.util.isSuperDuper(),
						socket: {
							hideInfo: !monster.socket.isEnabled(),
							URL: monster.config.api.socket,
							isConnected: monster.socket.isConnected()
						},
						kazooVersion: monster.config.developerFlags.kazooVersion
					},
					template = $(self.getTemplate({
						name: 'dialog-accountInfo',
						data: dataTemplate
					}));

				template.find('.copy-clipboard').each(function() {
					var $this = $(this);
					monster.ui.clipboard($this, function() {
						return $this.siblings('.to-copy').html();
					});
				});

				monster.ui.tooltips(template);

				monster.ui.dialog(template, {
					title: self.i18n.active().debugAccountDialog.title
				});
			}
		},

		showShortcutsPopup: function() {
			if (!$('.shortcuts-dialog').length) {
				var self = this,
					shortcuts = monster.ui.getShortcuts(),
					shortcutsTemplate = $(self.getTemplate({
						name: 'shortcuts',
						data: {
							categories: shortcuts
						}
					}));

				monster.ui.dialog(shortcutsTemplate, {
					title: self.i18n.active().globalShortcuts.popupTitle,
					width: 700
				});
			}
		},

		addShortcutsGoToApps: function(apps) {
			var self = this,
				shortcut,
				appsToBind = {
					voip: 'shift+v',
					accounts: 'shift+a',
					callflows: 'shift+c',
					branding: 'shift+b',
					provisioner: 'shift+p'
				};

			_.each(apps, function(app) {
				shortcut = {};

				if (appsToBind.hasOwnProperty(app.name)) {
					shortcut = {
						key: appsToBind[app.name],
						callback: function() {
							monster.routing.goTo('apps/' + app.name);
						},
						category: 'apps',
						title: app.label
					};

					monster.ui.addShortcut(shortcut);
				}
			});
		},

		// If current app needs websockets, and the socket just reconnected, we refresh the app to display the correct data
		refreshIfWebSocketsApp: function() {
			var self = this,
				currentApp = monster.apps[monster.apps.getActiveApp()];

			if (currentApp && currentApp.hasOwnProperty('requiresWebSockets') && currentApp.requiresWebSockets === true) {
				$('.warning-socket-wrapper').remove();
				currentApp.render();

				monster.ui.toast({
					type: 'success',
					message: self.i18n.active().brokenWebSocketsWarning.successReconnect
				});
			}
		},

		onSocketDisconnected: function() {
			var self = this,
				currentApp = monster.apps[monster.apps.getActiveApp()];

			if (currentApp && currentApp.hasOwnProperty('requiresWebSockets') && currentApp.requiresWebSockets === true) {
				self.showWarningSockets();
			}
		},

		// Show a warning displaying that WebSockets are not connected properly
		showWarningSockets: function(pArgs) {
			var self = this,
				args = pArgs || {},
				templateWarning = $(self.getTemplate({
					name: 'warning-disconnectedSocket'
				}));

			$('#monster_content').empty().append(templateWarning);

			if (args.hasOwnProperty('callback')) {
				args.callback && args.callback();
			}
		},

		/**
		 * Hide topbar dropdowns
		 * @param  {Object} [args]
		 * @param  {String} [args.except]  ID of any element that does not want to be hidden
		 */
		hideTopbarDropdowns: function(args) {
			if (!monster.util.isLoggedIn()) {
				// If user is not logged in, there is no menu displayed, so there is no need
				// to hide topbar dropdowns
				return;
			}

			var except = _.get(args, 'except');

			if (except !== 'main_topbar_account_toggle_link') {
				$('#main_topbar_account_toggle').removeClass('open');
			}
			if (except !== 'main_topbar_alerts_link') {
				monster.pub('core.alerts.hideDropdown');
			}
		}
	};

	return app;
});
