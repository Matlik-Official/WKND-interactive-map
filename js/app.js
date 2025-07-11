$(function() {
	var showCoordinations = true;
	var $types = $('.types');
	var onResize = function() {
		$types.css({
			maxHeight: $(window).height() - parseInt($types.css('marginTop'), 10) - parseInt($types.css('marginBottom'), 10) - parseInt($('header').height()) + 6,
		});
	};

	onResize();

	$(window).resize(onResize);

	var currentMarker;

	var timestampToSeconds = function(stamp) {
		stamp = stamp.split(':');
		return parseInt(stamp[0], 10) * 60 + parseInt(stamp[1], 10);
	};

	Handlebars.registerHelper('timestampToSeconds', timestampToSeconds);
	Handlebars.registerHelper('ifEquals', function(arg1, arg2, options) {
		return (arg1 == arg2) ? options.fn(this) : options.inverse(this);
	});

	var Vent = _.extend({}, Backbone.Events);

	var LocationModel = Backbone.Model.extend({
		initialize: function() {
			var polyCoords = this.get('latlngarray');

			if (!polyCoords || !Array.isArray(polyCoords)) {
				console.error('Invalid latlngarray:', polyCoords);
				return;
			}

			var marker = new google.maps.Polygon({
				paths: polyCoords,
				strokeColor: '#' + this.get('strokecolor'),
				strokeOpacity: 0.8,
				strokeWeight: 2,
				fillColor: '#' + this.get('fillcolor'),
				fillOpacity: 0.35,
				zIndex: this.get('order') || 0,
			});

			var bounds = new google.maps.LatLngBounds();
			polyCoords.forEach(function(element, index) {
				bounds.extend(element);
			});

			var mapLabel = new MapLabel({
				position: bounds.getCenter(),
				text: this.get('title'),
				strokeWeight: 1,
				strokeColor: '#000000',
				fontColor: '#' + this.get('fillcolor'),
				zIndex: 10000,
			});

			_.bindAll(this, 'markerClicked');
			google.maps.event.addListener(marker, 'click', this.markerClicked);
			this.set({ marker: marker, label: mapLabel });
		},

		markerClicked: function() {
			Vent.trigger('location:clicked', this);
		},

		removeHighlight: function() {},

		highlightMarker: function() {
			if (currentMarker == this) {
				Vent.trigger('location:clicked', this);
			} else {
				if (currentMarker) {
					currentMarker.removeHighlight();
				}
				mapView.closePopupLocation();
				currentMarker = this;
			}
		},
	});
	
	var LocationsCollection = Backbone.Collection.extend({
		model: LocationModel,
		url: 'http://127.0.0.1:8000/api/update-locations',
		
		parse: function(response) {
		  	return response.locations;
		}
	});

	var locations = new LocationsCollection();

	var MapView = Backbone.View.extend({
		initialize: function() {
			this.mapType = 'Satellite';
			this.mapDetails = {
				'Atlas':     '#0FA8D2',
				'Satellite': '#143D6B',
				'Road':      '#1862AD',
			};

			this.mapOptions = {
				center: new google.maps.LatLng(-60, -20),
				zoom: 3,
				disableDefaultUI: true,
				mapTypeId: this.mapType,
				backgroundColor: 'hsla(0, 0%, 0%, 0)',
			};

			_.bindAll(this, 'getTileImage', 'updateMapBackground');

			this.popupTemplate = Handlebars.compile($('#markerPopupTemplate2').html());

			this.listenTo(Vent, 'locations:visible', this.showLocations);
			this.listenTo(Vent, 'locations:invisible', this.hideLocations);
			this.listenTo(Vent, 'labels:visible', this.showLabels);
			this.listenTo(Vent, 'labels:invisible', this.hideLabels);
			this.listenTo(Vent, 'location:clicked', this.popupLocation);
		},

		render: function() {
			// Function to update coordination info windows
			function updateCoordinationWindow(markerobject) {
				function getContent(evt) {
					return '</p><p>{"lat": ' + evt.latLng.lat().toFixed(3) + ', "lng": ' + evt.latLng.lng().toFixed(3) + '},</p>';
				}

				// Create new info window
				var infoWindow = new google.maps.InfoWindow();

				// onClick listener
				google.maps.event.addListener(markerobject, 'click', function(evt) {
					infoWindow.setOptions({ content: getContent(evt) });

					// Open the info window
					infoWindow.open(map, markerobject);
				});

				// onDrag listener
				google.maps.event.addListener(markerobject, 'drag', function(evt) {
					infoWindow.setOptions({ content: getContent(evt) });
				});
				
				// delete listener
				google.maps.event.addListener(markerobject, 'rightclick', function(evt) {
					const index = window.locs.indexOf(markerobject);
					if (index > -1) {
						window.locs.splice(index, 1);
						markerobject.setMap(null);
						window.locs.forEach(function (item, index) {
							item.setLabel(String(index));
						});
					}
				});
			}

			var map = (this.map = window.map = new google.maps.Map(this.el, this.mapOptions));

			this.initMapTypes(map, _.keys(this.mapDetails));

			google.maps.event.addListener(map, 'maptypeid_changed', this.updateMapBackground);

			google.maps.event.addDomListener(map, 'tilesloaded', function() {
				if ($('#mapControlWrap').length == 0) {
					$('div.gmnoprint').last().wrap('<div id="mapControlWrap" />');
				}
			});

			window.locs = [];
			google.maps.event.addListener(map, 'rightclick', function(e) {
				var marker = new google.maps.Marker({
					map: map,
					moveable: true,
					draggable: true,
					position: e.latLng,
					label: String(window.locs.length),
				});
				window.locs.push(marker);
				// Check if coords mode is enabled
				if (showCoordinations) {
					// Update/create info window
					updateCoordinationWindow(marker);
				}
			});

			return this;
		},

		getMap: function() {
			return this.map;
		},

		initMapTypes: function(map, types) {
			_.each(
				types,
				function(type) {
					var mapTypeOptions = {
						minZoom: 1,
						maxZoom: 7,
						name: type,
						getTileUrl: this.getTileImage,
					};
					map.mapTypes.set(type, new google.maps.ImageMapType(mapTypeOptions));
				},
				this
			);
		},

		updateMapBackground: function() {
			this.mapType = this.map.getMapTypeId();
			this.$el.css({
				backgroundColor: this.mapDetails[this.mapType],
			});
		},

		getTileImage: function(rawCoordinates, zoomLevel) {
			var coord = this.normalizeCoordinates(rawCoordinates, zoomLevel);
			if (!coord) {
				return null;
			}
			return 'tiles/' + this.mapType.toLowerCase() + '/' + zoomLevel + '/' + coord.x + '_' + coord.y + '.png';
		},

		normalizeCoordinates: function(coord, zoom) {
			var y = coord.y;
			var x = coord.x;

			// tile range in one direction range is dependent on zoom level
			// 0 = 1 tile, 1 = 2 tiles, 2 = 4 tiles, 3 = 8 tiles, etc
			var tileRange = 1 << zoom;

			// don't repeat across y-axis (vertically)
			if (y < 0 || y >= tileRange) {
				return null;
			}

			// repeat across x-axis
			if (x < 0 || x >= tileRange) {
				x = ((x % tileRange) + tileRange) % tileRange;
			}

			return {
				x: x,
				y: y,
			};
		},

		showLocations: function(locations) {
			_.each(
				locations,
				function(location) {
					var marker = location.get('marker');
					if (!marker.getMap()) {
						marker.setMap(this.map);
					}
					marker.setVisible(true);
				},
				this
			);
		},

		showLabels: function(locations) {
			_.each(
				locations,
				function(location) {
					var label = location.get('label');
					if (!label.getMap()) {
						label.setMap(this.map);
					}
					label.set('fontSize', 16);
				},
				this
			);
		},

		hideLocations: function(locations) {
			_.each(locations, function(location) {
				location.get('marker').setVisible(false);
			});
		},

		hideLabels: function(locations) {
			_.each(locations, function(location) {
				var label = location.get('label');
				if (!label.getMap()) {
					label.setMap(this.map);
				}
				label.set('fontSize', 0);
			});
		},

		popupLocation: function(location, panTo) {
			var infoWindow = new google.maps.InfoWindow({
				content: this.popupTemplate(location.toJSON()),
			});

			infoWindow.setOptions({
				maxHeight: 400,
			});

			if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
				infoWindow.setOptions({
					maxWidth: 180,
					maxHeight: 300,
				});
			}
			var bounds = new google.maps.LatLngBounds();
			location
				.get('marker')
				.getPath()
				.forEach(function(element, index) {
					bounds.extend(element);
				});
			infoWindow.setPosition(bounds.getCenter());
			infoWindow.open(this.map);

			this.closePopupLocation();
			this.currentInfoWindow = infoWindow;
		},

		closePopupLocation: function() {
			if (this.currentInfoWindow) {
				this.currentInfoWindow.close();
			}
		},
	});

	var mapView = new MapView({
		el: '#map',
	});

	locations.fetch({
		success: function() {
			mapView.render();
			Vent.trigger('locations:visible', locations.models);
		},
		error: function(collection, response, options) {
			console.error('Failed to fetch locations:', response);
		}
	});
});

function toggleRuler() {
	addruler(window.map);
}

function addruler(map) {
	ruler1 = new google.maps.Marker({
		position: map.getCenter(),
		map: map,
		draggable: true,
	});

	ruler2 = new google.maps.Marker({
		position: map.getCenter(),
		map: map,
		draggable: true,
	});

	var ruler1label = new Label({ map: map, position: map.getCenter(), text: '0m' });

	rulerpoly = new google.maps.Polyline({
		path: [ruler1.position, ruler2.position],
		strokeColor: '#FFFF00',
		strokeOpacity: 0.7,
		strokeWeight: 8,
	});
	rulerpoly.setMap(map);

	google.maps.event.addListener(ruler1, 'drag', function() {
		ruler1label.set('position', ruler1.position);
		rulerpoly.setPath([ruler1.getPosition(), ruler2.getPosition()]);
		ruler1label.set('text', distance(ruler1.getPosition().lat(), ruler1.getPosition().lng(), ruler2.getPosition().lat(), ruler2.getPosition().lng()));
	});

	google.maps.event.addListener(ruler2, 'drag', function() {
		rulerpoly.setPath([ruler1.getPosition(), ruler2.getPosition()]);
		ruler1label.set('text', distance(ruler1.getPosition().lat(), ruler1.getPosition().lng(), ruler2.getPosition().lat(), ruler2.getPosition().lng()));
	});

	ruler1.setVisible(true);
	ruler2.setVisible(true);
	rulerpoly.setVisible(true);
}

function distance(lat1, lon1, lat2, lon2) {
	var um = 'km'; // km | ft (choose the constant)
	var R = 1800;
	if (um == 'ft') {
		R = 20924640; // ft
	}
	var dLat = ((lat2 - lat1) * Math.PI) / 180;
	var dLon = ((lon2 - lon1) * Math.PI) / 180;
	var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
	var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	var d = R * c * 4;
	return Math.round(d) + 'm';
}

// Define the overlay, derived from google.maps.OverlayView
function Label(opt_options) {
	// Initialization
	this.setValues(opt_options);

	// Label specific
	var span = (this.span_ = document.createElement('span'));
	span.style.cssText =
		'position: relative; left: 0%; top: -8px; ' +
		'white-space: nowrap; border: 0px; font-family:arial; font-weight:bold;' +
		'padding: 2px; background-color: #ddd; ' +
		'opacity: 1; ' +
		'filter: alpha(opacity=75); ' +
		'-ms-filter: "alpha(opacity=75)"; ' +
		'-khtml-opacity: 1; ' +
		'z-index:1000';

	var div = (this.div_ = document.createElement('div'));
	div.appendChild(span);
	div.style.cssText = 'position: absolute; display: none';
}
Label.prototype = new google.maps.OverlayView();

// Implement onAdd
Label.prototype.onAdd = function() {
	var pane = this.getPanes().overlayLayer;
	pane.appendChild(this.div_);

	// Ensures the label is redrawn if the text or position is changed.
	var me = this;
	this.listeners_ = [
		google.maps.event.addListener(this, 'position_changed', function() {
			me.draw();
		}),
		google.maps.event.addListener(this, 'text_changed', function() {
			me.draw();
		}),
	];
};

// Implement onRemove
Label.prototype.onRemove = function() {
	this.div_.parentNode.removeChild(this.div_);
	// Label is removed from the map, stop updating its position/text.
	for (var i = 0, I = this.listeners_.length; i < I; ++i) {
		google.maps.event.removeListener(this.listeners_[i]);
	}
};

// Implement draw
Label.prototype.draw = function() {
	var projection = this.getProjection();
	var position = projection.fromLatLngToDivPixel(this.get('position'));

	var div = this.div_;
	div.style.left = position.x + 'px';
	div.style.top = position.y + 'px';
	div.style.display = 'block';

	this.span_.innerHTML = this.get('text').toString();
};
