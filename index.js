require('./node_modules/css-modal/build/modal.css');
require('./node_modules/openlayers/dist/ol.css');
require('./index.css');

var cw = require('catiline');
var ol = require('openlayers/dist/ol');
var ss = require('simple-statistics');

// Base map
var baseLayer = new ol.layer.Tile();
var xhr = new XMLHttpRequest();
xhr.open('GET', 'http://www.basemap.at/wmts/1.0.0/WMTSCapabilities.xml');
xhr.onload = function() {
  var caps = new ol.format.WMTSCapabilities().read(xhr.responseText);
  var hiDPI = ol.has.DEVICE_PIXEL_RATIO >= 1.5;
  var options = ol.source.WMTS.optionsFromCapabilities(caps, {
    layer: hiDPI ? 'bmaphidpi' : 'geolandbasemap',
    matrixSet: 'google3857',
    requestEncoding: 'REST',
    style: 'normal'
  });
  options.tilePixelRatio = hiDPI ? 2 : 1;
  baseLayer.setSource(new ol.source.WMTS(options));
};
xhr.send();

// Data layer
var dataLayer = new ol.layer.Vector({
  source: new ol.source.Vector(),
  opacity: 0.6
});
var style = new ol.style.Style({
  fill: new ol.style.Fill({
    color: '#000'
  })
});
var styles = [style];
var empty = [new ol.style.Style({
  fill: new ol.style.Fill({
    color: 'rgba(255,255,255,0.4)'
  }),
  stroke: new ol.style.Stroke({
    color: '#3399CC',
    width: 1.25
  })
})];
dataLayer.setStyle(function(feature) {
  var normalizedData = feature.get('NORMALIZED DATA');
  if (!normalizedData) {
    return empty;
  }
  var color;
  if (normalizedData < -1) {
    color = '#c51b7d';
  } else if (-1 < normalizedData && normalizedData < -0.5) {
    color = '#e9a3c9';
  } else if (-0.5 < normalizedData && normalizedData < 0) {
    color = '#fde0ef';
  } else if (0 < normalizedData && normalizedData < 0.5) {
    color = '#e6f5d0';
  } else if (0.5 < normalizedData && normalizedData < 1) {
    color = '#a1d76a';
  } else if (1 < normalizedData) {
    color = '#4d9221';
  }
  style.getFill().setColor(color);
  return styles;
});

// Map object
var olMap = new ol.Map({
  target: 'map',
  renderer: 'canvas',
  layers: [baseLayer, dataLayer],
  view: new ol.View({
    center: ol.proj.fromLonLat([13.5, 47.5]),
    zoom: 7
  })
});

// Handle user input
var csvDropdown = document.getElementById('csvkey');
var shpDropdown = document.getElementById('shpkey');
var renderButton = document.getElementById('renderbutton');
var formulaField = document.getElementById('formula');
var configForm = document.getElementById('config');
var saveButton = document.getElementById('savebutton');
var loadButton = document.getElementById('loadbutton');
function populateFields(select, fields) {
  select.removeChild(select.firstElementChild);
  select.disabled = false;
  fields.forEach(function(field) {
    var option = document.createElement('option');
    option.value = field;
    option.innerHTML = field;
    select.appendChild(option);
  });
}
function render() {
  if (renderButton.disabled) {
    return;
  }
  var formula = formulaField.value;
  saveButton.disabled = !formula;
  var features = dataLayer.getSource().getFeatures();
  var values = [];
  features.forEach(function(feature) {
    var value;
    /*eslint-disable no-with, no-eval */
    with (feature.getProperties()) {
      value = Number(eval(formula));
    }
    /*eslint-enable no-with, no-eval */
    values.push(value);
    feature.unset('DATA');
    feature.unset('NORMALIZED DATA');
    feature.set('DATA', value);
  });
  var stdDev = ss.standard_deviation(values);
  var avg = ss.average(values);
  features.forEach(function(feature) {
    var data = feature.get('DATA');
    if (data) {
      feature.set('NORMALIZED DATA', (data - avg) / stdDev);
    }
  });
}
var args = {};
if (window.location.search) {
  var argsArray = window.location.search.substr(1).split('&');
  argsArray.forEach(function(arg) {
    var sides = arg.split('=');
    args[sides[0]] = decodeURIComponent(sides[1]);
  });
  if (args.formula) {
    formulaField.value = args.formula;
  }
  if (args.data) {
    formulaField.disabled = false;
    var dataXhr = new XMLHttpRequest();
    dataXhr.open('GET', args.data);
    dataXhr.onload = function() {
      if (dataXhr.status === 200) {
        var source = dataLayer.getSource();
        source.addFeatures(new ol.format.GeoJSON().readFeatures(
            JSON.parse(dataXhr.responseText),
            {featureProjection: olMap.getView().getProjection()}));
        olMap.getView().fit(source.getExtent(), olMap.getSize());
        var fields = source.getFeatures()[0].getKeys();
        populateFields(shpDropdown, fields);
        renderButton.disabled = false;
        render();
      }
    };
    dataXhr.send();
  }
}
var csvFields;
configForm.addEventListener('submit', render);
var csvLines;
function handleFieldSelect() {
  var csvData, item;
  if (csvDropdown.selectedIndex > 0) {
    var csvKey = csvDropdown.options[csvDropdown.selectedIndex].value;
    csvData = {};
    var csvValues, field;
    csvLines.forEach(function(line) {
      if (!line) {
        return;
      }
      csvValues = line.split(';');
      item = {};
      for (var j = 0, jj = csvFields.length; j < jj; ++j) {
        field = csvFields[j];
        item[field] = csvValues[j];
        if (field === csvKey) {
          csvData[csvValues[j]] = item;
        }
      }
    });
  }
  if (shpDropdown.selectedIndex > 0) {
    if (csvData) {
      var shpKey = shpDropdown.options[shpDropdown.selectedIndex].value;
      var features = dataLayer.getSource().getFeatures();
      features.forEach(function(feature) {
        var key = feature.get(shpKey);
        item = csvData[key];
        if (item) {
          for (var j in item) {
            feature.set(j, item[j]);
          }
        }
      });
    }
  }
}
shpDropdown.addEventListener('change', handleFieldSelect);

// Handle drag & drop for CSV and Shape ZIP files
var dropbox = document.getElementById('map');
var csvDropped = false;
var shpDropped = false;
var shpWorker = cw(function(data) {
  /*global importScripts:true */
  importScripts('build/shp.min.js');
  return shp.parseZip(data);
});
function handleCsvFile(file) {
  csvDropped = true;
  csvDropdown.firstElementChild.innerHTML = 'Loading csv...';
  var reader = new FileReader();
  reader.onload = function() {
    csvLines = reader.result.split(/\r?\n/);
    csvFields = csvLines.shift().split(';');
    populateFields(csvDropdown, csvFields);
    formulaField.disabled = false;
  };
  reader.readAsText(file);
}
function handleShapeFile(file) {
  shpDropped = true;
  shpDropdown.firstElementChild.innerHTML = 'Loading shp...';
  var reader = new FileReader();
  reader.onload = function() {
    shpWorker.data(reader.result, [reader.result]).then(function(geojson) {
      var source = dataLayer.getSource();
      source.addFeatures(
          new ol.format.GeoJSON().readFeatures(geojson,
              {featureProjection: olMap.getView().getProjection()}));
      var fields = source.getFeatures()[0].getKeys();
      populateFields(shpDropdown, fields);
      renderButton.disabled = false;
      olMap.getView().fit(source.getExtent(), olMap.getSize());
    });
  };
  reader.readAsArrayBuffer(file);
}
function stop(e) {
  e.stopPropagation();
  e.preventDefault();
  if (!shpDropped || !csvDropped) {
    e.dataTransfer.dropEffect = 'copy';
  }
}
function drop(e) {
  stop(e);
  var files = e.dataTransfer.files;
  var file;
  for (var i = 0, ii = files.length; i < ii; ++i) {
    file = files.item(i);
    if (!shpDropped && /\.zip$/.test(file.name)) {
      handleShapeFile(file);
    } else if (!csvDropped && /\.csv$/.test(file.name)) {
      handleCsvFile(file);
    }
  }
}
dropbox.addEventListener('dragenter', stop, false);
dropbox.addEventListener('dragover', stop, false);
dropbox.addEventListener('drop', drop, false);
csvDropdown.addEventListener('change', handleFieldSelect);

// Save data
var loginForm = document.getElementById('login-form');
var authToken;
function save() {
  var req = new XMLHttpRequest();
  req.open('POST', 'https://api.github.com/gists');
  req.setRequestHeader('Authorization', 'token ' + authToken);
  req.onload = function() {
    if (req.status === 201) {
      var url = JSON.parse(req.responseText).files['map.geojson'].raw_url;
      var parts = window.location.href.split(/[\?\#]/);
      window.location.href = parts[0] + '?data=' + encodeURIComponent(url) +
          '&formula=' + encodeURIComponent(formulaField.value) +
          window.location.hash;
    }
  };
  req.send(JSON.stringify({
    description: 'gist from regional-monitoring app',
    public: true,
    files: {
      'map.geojson': {
        content: JSON.stringify(new ol.format.GeoJSON().writeFeatures(
            dataLayer.getSource().getFeatures(),
            {featureProjection: olMap.getView().getProjection()}))
      }
    }
  }));
}
function authorize(cb) {
  var username = document.getElementById('username').value;
  var password = document.getElementById('password').value;
  var req = new XMLHttpRequest();
  req.open('POST', 'https://api.github.com/authorizations');
  req.setRequestHeader('Authorization', 'Basic ' +
      btoa(username + ':' + password));
  req.onload = function() {
    if (req.status === 201) {
      authToken = JSON.parse(req.responseText).token;
      cb();
    }
  };
  req.send(JSON.stringify({
    scopes: ['gist'],
    note: 'gist for regional-monitoring app',
    fingerprint: String(Math.random())
  }));
}
saveButton.addEventListener('click', function() {
  if (args.data && formulaField.value) {
    window.location.href =
        window.location.search + '&formula=' + formulaField.value;
    return;
  }
  if (!authToken) {
    window.location.href = '#modal-login';
  } else {
    save();
  }
});
loginForm.addEventListener('submit', function() {
  window.location.href = '#!';
  authorize(save);
});

// Load GeoJSON
var loadForm = document.getElementById('load-form');
loadButton.addEventListener('click', function() {
  window.location.href = '#modal-load';
});
loadForm.addEventListener('submit', function() {
  window.location.href = '?data=' +
      encodeURIComponent(document.getElementById('geojsonurl').value) + '#!';
});

// Popup overlay for feature info.
var container = document.getElementById('popup');
var content = document.getElementById('popup-content');
var closer = document.getElementById('popup-closer');
var overlay = new ol.Overlay({
  element: container,
  autoPan: true,
  autoPanAnimation: {
    duration: 250
  },
  autoPanMargin: 50
});
overlay.setMap(olMap);
function closePopup() {
  overlay.setPosition(undefined);
  closer.blur();
  return false;
}
closer.onclick = closePopup;

// Handle map clicks to show feature info in the popup
olMap.on('singleclick', function(evt) {
  var info;
  olMap.forEachFeatureAtPixel(evt.pixel, function(feature) {
    var attrs = feature.getProperties();
    var geometryName = feature.getGeometryName();
    info = [];
    for (var i in attrs) {
      if (attrs.hasOwnProperty(i) && i !== geometryName) {
        info.push('<div><b>' + i + '</b>: ' + attrs[i] + '</div>');
      }
    }
    content.innerHTML = info.join('');
  });
  if (info) {
    overlay.setPosition(evt.coordinate);
  } else {
    closePopup();
  }
});
