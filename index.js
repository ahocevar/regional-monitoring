require('./node_modules/bootstrap/dist/css/bootstrap.min.css');
require('./node_modules/openlayers/dist/ol.css');
require('./index.css');

var cw = require('catiline');
var ol = require('openlayers/dist/ol');
var shp = require('shpjs');
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
dataLayer.setStyle(function(feature, resolution) {
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
olMap = new ol.Map({
  target: 'map',
  renderer: 'canvas',
  layers: [baseLayer, dataLayer],
  view: new ol.View({
    center: ol.proj.fromLonLat([13.5, 47.5]),
    zoom: 7
  })
});

// Handle user input
var formulaField = document.getElementById('formula');
var configForm = document.getElementById('config');
configForm.addEventListener('submit', function() {
  if (renderButton.disabled) {
    return;
  }
  var formula = formulaField.value;
  var features = dataLayer.getSource().getFeatures();
  var values = [];
  features.forEach(function(feature) {
    with (feature.getProperties()) {
      value = Number(eval(formula));
    }
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
});
function handleFieldSelect(e) {
  var csvData, item;
  if (csvDropdown.selectedIndex > 0) {
    var csvKey = csvDropdown.options[csvDropdown.selectedIndex].value;
    var dataIndex = csvFields.indexOf(csvKey);
    csvData = {};
    var values = [];
    var csvValues, field, line, value;
    csvLines.forEach(function(line) {
      if (!line) {
        return;
      }
      csvValues = line.split(';');
      item = {};
      for (var j = 0, jj = csvFields.length; j < jj; ++j) {
        field = csvFields[j];
        item[field] = csvValues[j];
        if (field == csvKey) {
          value = csvValues[dataIndex];
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

// Handle drag & drop for CSV and Shape ZIP files
var dropbox = document.getElementById('map');
dropbox.addEventListener("dragenter", stop, false);
dropbox.addEventListener("dragover", stop, false);
dropbox.addEventListener("drop", drop, false);
var csvDropped = false;
var csvDropdown = document.getElementById('csvkey');
var csvFields, csvLines;
csvDropdown.addEventListener('change', handleFieldSelect);
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
var shpWorker = cw(function(data) {
  importScripts('build/shp.min.js');
  return shp.parseZip(data);
});
var shpDropped = false;
var shpDropdown = document.getElementById('shpkey');
var renderButton = document.getElementById('renderbutton');
shpDropdown.addEventListener('change', handleFieldSelect);
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

// Popup overlay for feature info.
var container = document.getElementById('popup');
var content = document.getElementById('popup-content');
var closer = document.getElementById('popup-closer');
function closePopup() {
  overlay.setPosition(undefined);
  closer.blur();
  return false;
}
closer.onclick = closePopup;
var overlay = new ol.Overlay({
  element: container,
  autoPan: true,
  autoPanAnimation: {
    duration: 250
  },
  autoPanMargin: 50
}));
overlay.setMap(olMap);

// Handle map clicks to show feature info in the popup
olMap.on('singleclick', function(evt) {
  var info;
  olMap.forEachFeatureAtPixel(evt.pixel, function(feature) {
    var attrs = feature.getProperties();
    var geometryName = feature.getGeometryName();
    info = [];
    for (var i in attrs) {
      if (attrs.hasOwnProperty(i) && i != geometryName) {
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
