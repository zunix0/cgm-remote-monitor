//TODO: clean up
var app = {}, browserSettings = {}, browserStorage = $.localStorage;

(function () {
    'use strict';

    var BRUSH_TIMEOUT = 300000 // 5 minutes in ms
        , TOOLTIP_TRANS_MS = 200 // milliseconds
        , UPDATE_TRANS_MS = 750 // milliseconds
        , ONE_MIN_IN_MS = 60000
        , FIVE_MINS_IN_MS = 300000
        , SIX_MINS_IN_MS =  360000
        , TWENTY_FIVE_MINS_IN_MS = 1500000
        , THIRTY_MINS_IN_MS = 1800000
        , SIXTY_MINS_IN_MS = 3600000
        , FOCUS_DATA_RANGE_MS = 12600000 // 3.5 hours of actual data
        , FORMAT_TIME_12 = '%I:%M'
        , FORMAT_TIME_24 = '%H:%M%'
        , FORMAT_TIME_SCALE = '%I %p'
        , WIDTH_SMALL_DOTS = 400
        , WIDTH_BIG_DOTS = 800
        , MINUTES_SINCE_LAST_UPDATE_WARN = 10
        , MINUTES_SINCE_LAST_UPDATE_URGENT = 20;

    var socket
        , isInitialData = false
        , latestSGV
        , latestUpdateTime
        , prevSGV
        , treatments
        , cal
        , padding = { top: 20, right: 10, bottom: 30, left: 10 }
        , opacity = {current: 1, DAY: 1, NIGHT: 0.5}
        , now = Date.now()
        , data = []
        , audio = document.getElementById('audio')
        , alarmInProgress = false
        , currentAlarmType = null
        , alarmSound = 'alarm.mp3'
        , urgentAlarmSound = 'alarm2.mp3';

    var jqWindow
        , tooltip
        , tickValues
        , charts
        , futureOpacity
        , focus
        , context
        , xScale, xScale2, yScale, yScale2
        , xAxis, yAxis, xAxis2, yAxis2
        , prevChartWidth = 0
        , prevChartHeight = 0
        , focusHeight
        , contextHeight
        , dateFn = function (d) { return new Date(d.date) }
        , brush
        , brushTimer
        , brushInProgress = false
        , clip;

    function formatTime(time) {
        var timeFormat = getTimeFormat();
        time = d3.time.format(timeFormat)(time);
        if(timeFormat == FORMAT_TIME_12){
            time = time.replace(/^0/, '').toLowerCase();
        }
      return time;
    }

    function getTimeFormat(isForScale) {
        var timeFormat = FORMAT_TIME_12;
        if (browserSettings.timeFormat) {
            if (browserSettings.timeFormat == '24') {
                timeFormat = FORMAT_TIME_24;
            }
        }

        if (isForScale && (timeFormat == FORMAT_TIME_12)) {
            timeFormat = FORMAT_TIME_SCALE
        }

        return timeFormat;
    }

    var x2TickFormat = d3.time.format.multi([
        ['.%L', function(d) { return d.getMilliseconds(); }],
        [':%S', function(d) { return d.getSeconds(); }],
        ['%I:%M', function(d) { return d.getMinutes(); }],
        [(getTimeFormat() == FORMAT_TIME_12) ? '%I %p': '%H:%M%', function(d) { return d.getHours(); }],
        ['%a %d', function(d) { return d.getDay() && d.getDate() != 1; }],
        ['%b %d', function(d) { return d.getDate() != 1; }],
        ['%B', function(d) { return d.getMonth(); }],
        ['%Y', function() { return true; }]
    ]);


    // lixgbg: Convert mg/dL BG value to metric mmol
    function scaleBg(bg) {
        if (browserSettings.units == 'mmol') {
            return (Math.round((bg / 18) * 10) / 10).toFixed(1);
        } else {
            return bg;
        }
    }

    function showRawBGs() {
        return app.enabledOptions
            && app.enabledOptions.indexOf('rawbg' > -1)
            && (browserSettings.showRawbg == 'always' || browserSettings.showRawbg == 'noise');
    }

    function rawIsigToRawBg(entry, cal) {

      var unfiltered = parseInt(entry.unfiltered) || 0
        , filtered = parseInt(entry.filtered) || 0
        , sgv = entry.y
        , noise = entry.noise || 0
        , scale = parseFloat(cal.scale) || 0
        , intercept = parseFloat(cal.intercept) || 0
        , slope = parseFloat(cal.slope) || 0;

        if (slope == 0 || unfiltered == 0 || scale == 0) {
          return 0;
        } else if (noise < 2 && browserSettings.showRawbg != 'always') {
          return 0;
        } else if (filtered == 0 || sgv < 40) {
            console.info("Skipping ratio adjustment for SGV " + sgv);
            return scale * (unfiltered - intercept) / slope;
        } else {
            var ratio = scale * (filtered - intercept) / slope / sgv;
            return scale * ( unfiltered - intercept) / slope / ratio;
        }
    }

    // initial setup of chart when data is first made available
    function initializeCharts() {

        // define the parts of the axis that aren't dependent on width or height
        xScale = d3.time.scale()
            .domain(d3.extent(data, function (d) { return d.date; }));

        yScale = d3.scale.log()
            .domain([scaleBg(30), scaleBg(510)]);

        xScale2 = d3.time.scale()
            .domain(d3.extent(data, function (d) { return d.date; }));

        yScale2 = d3.scale.log()
            .domain([scaleBg(36), scaleBg(420)]);

        xAxis = d3.svg.axis()
            .scale(xScale)
            .tickFormat(d3.time.format(getTimeFormat(true)))
            .ticks(4)
            .orient('top');

        yAxis = d3.svg.axis()
            .scale(yScale)
            .tickFormat(d3.format('d'))
            .tickValues(tickValues)
            .orient('left');

      xAxis2 = d3.svg.axis()
          .scale(xScale2)
          .tickFormat(x2TickFormat)
          .ticks(4)
          .orient('bottom');

        yAxis2 = d3.svg.axis()
            .scale(yScale2)
            .tickFormat(d3.format('d'))
            .tickValues(tickValues)
            .orient('right');

        // setup a brush
        brush = d3.svg.brush()
            .x(xScale2)
            .on('brushstart', brushStarted)
            .on('brush', brushed)
            .on('brushend', brushEnded);

        updateChart(true);
    }

    // get the desired opacity for context chart based on the brush extent
    function highlightBrushPoints(data) {
        if (data.date.getTime() >= brush.extent()[0].getTime() && data.date.getTime() <= brush.extent()[1].getTime()) {
            return futureOpacity(data.date.getTime() - latestSGV.x);
        } else {
            return 0.5;
        }
    }

    // clears the current user brush and resets to the current real time data
    function updateBrushToNow() {

        // get current time range
        var dataRange = d3.extent(data, dateFn);

        // update brush and focus chart with recent data
        d3.select('.brush')
            .transition()
            .duration(UPDATE_TRANS_MS)
            .call(brush.extent([new Date(dataRange[1].getTime() - FOCUS_DATA_RANGE_MS), dataRange[1]]));
        brushed(true);

        // clear user brush tracking
        brushInProgress = false;
    }

    function brushStarted() {
        // update the opacity of the context data points to brush extent
        context.selectAll('circle')
            .data(data)
            .style('opacity', function (d) { return 1; });
    }

    function brushEnded() {
        // update the opacity of the context data points to brush extent
        context.selectAll('circle')
            .data(data)
            .style('opacity', function (d) { return highlightBrushPoints(d) });
    }

    function inRetroMode() {
        if (!brush) return false;
        
        var brushExtent = brush.extent();
        var elementHidden = document.getElementById('bgButton').hidden == '';
        return brushExtent[1].getTime() - THIRTY_MINS_IN_MS < now && elementHidden != true;
    }

    function errorCodeToDisplay(errorCode) {
        var errorDisplay;

        switch (parseInt(errorCode)) {
            case 0:  errorDisplay = '??0'; break; //None
            case 1:  errorDisplay = '?SN'; break; //SENSOR_NOT_ACTIVE
            case 2:  errorDisplay = '??2'; break; //MINIMAL_DEVIATION
            case 3:  errorDisplay = '?NA'; break; //NO_ANTENNA
            case 5:  errorDisplay = '?NC'; break; //SENSOR_NOT_CALIBRATED
            case 6:  errorDisplay = '?CD'; break; //COUNTS_DEVIATION
            case 7:  errorDisplay = '??7'; break; //?
            case 8:  errorDisplay = '??8'; break; //?
            case 9:  errorDisplay = '&#8987;'; break; //ABSOLUTE_DEVIATION
            case 10: errorDisplay = '???'; break; //POWER_DEVIATION
            case 12: errorDisplay = '?RF'; break; //BAD_RF
            default: errorDisplay = '?' + parseInt(errorCode) + '?'; break;
        }

        return errorDisplay;
    }

    function noiseCodeToDisplay(noise) {
        var display = 'Not Set';
        switch (parseInt(noise)) {
            case 1: display = 'Clean'; break;
            case 2: display = 'Light'; break;
            case 3: display = 'Medium'; break;
            case 4: display = 'Heavy'; break;
            case 5: display = 'Unknown'; break;
        }

        return display;
    }

    // function to call when context chart is brushed
    function brushed(skipTimer) {

        if (!skipTimer) {
            // set a timer to reset focus chart to real-time data
            clearTimeout(brushTimer);
            brushTimer = setTimeout(updateBrushToNow, BRUSH_TIMEOUT);
            brushInProgress = true;
        }

        var brushExtent = brush.extent();

        // ensure that brush extent is fixed at 3.5 hours
        if (brushExtent[1].getTime() - brushExtent[0].getTime() != FOCUS_DATA_RANGE_MS) {

            // ensure that brush updating is with the time range
            if (brushExtent[0].getTime() + FOCUS_DATA_RANGE_MS > d3.extent(data, dateFn)[1].getTime()) {
                brushExtent[0] = new Date(brushExtent[1].getTime() - FOCUS_DATA_RANGE_MS);
                d3.select('.brush')
                    .call(brush.extent([brushExtent[0], brushExtent[1]]));
            } else {
                brushExtent[1] = new Date(brushExtent[0].getTime() + FOCUS_DATA_RANGE_MS);
                d3.select('.brush')
                    .call(brush.extent([brushExtent[0], brushExtent[1]]));
            }
        }

        var nowDate = new Date(brushExtent[1] - THIRTY_MINS_IN_MS);

        var currentBG = $('.bgStatus .currentBG')
            , currentDirection = $('.bgStatus .currentDirection')
            , currentDetails = $('.bgStatus .currentDetails');

        function updateCurrentSGV(value) {
            if (value < 39) {
                currentBG.html(errorCodeToDisplay(value)).toggleClass('error-code');
            } else if (value < 40) {
                currentBG.text('LOW');
            } else if (value > 400) {
                currentBG.text('HIGH');
            } else {
                currentBG.text(scaleBg(value));
            }

            currentBG.toggleClass('error-code', value < 39);
            currentBG.toggleClass('bg-limit', value == 39 || value > 400);
        }

        function calcBGDelta(prev, current) {

            var bgDeltaString;

            if (prev < 40 || prev > 400 || current < 40 || current > 400) {
                bgDeltaString = '';
            } else {
                var bgDelta = scaleBg(current) - scaleBg(prev);
                if (browserSettings.units == 'mmol') {
                    bgDelta = bgDelta.toFixed(1);
                }

                bgDeltaString = bgDelta;
                if (bgDelta >= 0) {
                    bgDeltaString = '+' + bgDelta;
                }

                if (browserSettings.units == 'mmol') {
                    bgDeltaString = bgDeltaString + ' mmol/L'
                } else {
                    bgDeltaString = bgDeltaString + ' mg/dL'
                }
            }

            return bgDeltaString;
        }

        var color = inRetroMode() ? 'grey' : sgvToColor(latestSGV.y);

        $('.container #noButton .currentBG').css({color: color});
        $('.container #noButton .currentDirection').css({color: color});
        $('.container #noButton .currentDetails').css({color: color});

        // predict for retrospective data
        // by changing lookback from 1 to 2, we modify the AR algorithm to determine its initial slope from 10m
        // of data instead of 5, which eliminates the incorrect and misleading predictions generated when
        // the dexcom switches from unfiltered to filtered at the start of a rapid rise or fall, while preserving
        // almost identical predications at other times.
        var lookback = 2;

        var nowData = data.filter(function(d) {
            return d.type == 'sgv';
        });

        if (inRetroMode()) {
            // filter data for -12 and +5 minutes from reference time for retrospective focus data prediction
            var lookbackTime = (lookback + 2) * FIVE_MINS_IN_MS + 2 * ONE_MIN_IN_MS;
            nowData = nowData.filter(function(d) {
                return d.date.getTime() >= brushExtent[1].getTime() - TWENTY_FIVE_MINS_IN_MS - lookbackTime &&
                    d.date.getTime() <= brushExtent[1].getTime() - TWENTY_FIVE_MINS_IN_MS
            });

            // sometimes nowData contains duplicates.  uniq it.
            var lastDate = new Date('1/1/1970');
            nowData = nowData.filter(function(d) {
                var ok = (lastDate.getTime() + ONE_MIN_IN_MS) < d.date.getTime();
                lastDate = d.date;
                return ok;
            });

            if (nowData.length > lookback) {
                var focusPoint = nowData[nowData.length - 1];
                var prevfocusPoint = nowData[nowData.length - 2];

                updateCurrentSGV(focusPoint.y);

                currentBG.css('text-decoration','line-through');
                currentDirection.html(focusPoint.y < 39 ? '✖' : focusPoint.direction);
                currentDetails.text(calcBGDelta(prevfocusPoint.y, focusPoint.y)).css('text-decoration','line-through');
            } else {
                currentBG.text('---').css('text-decoration','');
                currentDirection.text('-');
                currentDetails.text('');
            }

            $('#currentTime')
                .text(formatTime(new Date(brushExtent[1] - THIRTY_MINS_IN_MS)))
                .css('text-decoration','line-through');

            $('#lastEntry').text('RETRO').removeClass('current');
        } else {
            // if the brush comes back into the current time range then it should reset to the current time and sg
            nowData = nowData.slice(nowData.length - 1 - lookback, nowData.length);
            nowDate = new Date(now);

            updateCurrentSGV(latestSGV.y);
            updateClockDisplay();
            updateTimeAgo();

            currentBG.css('text-decoration', '');
            currentDirection.html(latestSGV.y < 39 ? '✖' : latestSGV.direction);
            currentDetails.text(calcBGDelta(prevSGV.y, latestSGV.y)).css('text-decoration','');
        }

        xScale.domain(brush.extent());

        // get slice of data so that concatenation of predictions do not interfere with subsequent updates
        var focusData = data.slice();
        if (nowData.length > lookback) {
            focusData = focusData.concat(predictAR(nowData, lookback));
        }

        // bind up the focus chart data to an array of circles
        // selects all our data into data and uses date function to get current max date
        var focusCircles = focus.selectAll('circle').data(focusData, dateFn);

        var dotRadius = function(type) {
            var radius = prevChartWidth > WIDTH_BIG_DOTS ? 4 : (prevChartWidth < WIDTH_SMALL_DOTS ? 2 : 3);
            if (type == 'mbg') radius *= 2;
            else if (type == 'rawbg') radius = Math.min(2, radius - 1);
            return radius;
        };

        function prepareFocusCircles(sel) {
            sel.attr('cx', function (d) { return xScale(d.date); })
                .attr('cy', function (d) { return yScale(d.sgv); })
                .attr('fill', function (d) { return d.color; })
                .attr('opacity', function (d) { return futureOpacity(d.date.getTime() - latestSGV.x); })
                .attr('stroke-width', function (d) { if (d.type == 'mbg') return 2; else return 0; })
                .attr('stroke', function (d) {
                    var device = d.device && d.device.toLowerCase();
                    return (device == 'dexcom' ? 'white' : '#0099ff');
                })
                .attr('r', function (d) { return dotRadius(d.type); });

            return sel;
        }

        // if already existing then transition each circle to its new position
        prepareFocusCircles(focusCircles.transition().duration(UPDATE_TRANS_MS));

        // if new circle then just display
        prepareFocusCircles(focusCircles.enter().append('circle'))
            .on('mouseover', function (d) {
                if (d.type != 'sgv' && d.type != 'mbg') return;

                var device = d.device && d.device.toLowerCase();
                var bgType = (d.type == 'sgv' ? 'CGM' : (device == 'dexcom' ? 'Calibration' : 'Meter'));
                var noiseLabel = '';

                if (d.type == 'sgv' && showRawBGs()) {
                    noiseLabel = noiseCodeToDisplay(d.noise);
                }

                tooltip.transition().duration(TOOLTIP_TRANS_MS).style('opacity', .9);
                tooltip.html('<strong>' + bgType + ' BG:</strong> ' + d.sgv +
                    (d.type == 'mbg' ? '<br/><strong>Device: </strong>' + d.device : '') +
                    (noiseLabel ? '<br/><strong>Noise:</strong> ' + noiseLabel : '') +
                    '<br/><strong>Time:</strong> ' + formatTime(d.date))
                    .style('left', (d3.event.pageX) + 'px')
                    .style('top', (d3.event.pageY - 28) + 'px');
            })
            .on('mouseout', function (d) {
                if (d.type != 'sgv' && d.type != 'mbg') return;
                tooltip.transition()
                    .duration(TOOLTIP_TRANS_MS)
                    .style('opacity', 0);
            });

        focusCircles.exit()
            .remove();

        // remove all insulin/carb treatment bubbles so that they can be redrawn to correct location
        d3.selectAll('.path').remove();

        // add treatment bubbles
        // a higher bubbleScale will produce smaller bubbles (it's not a radius like focusDotRadius)
        var bubbleScale = prevChartWidth < WIDTH_SMALL_DOTS ? 4 : (prevChartWidth < WIDTH_BIG_DOTS ? 3 : 2);
        focus.selectAll('circle')
            .data(treatments)
            .each(function (d) { drawTreatment(d, bubbleScale, true) });

        // transition open-top line to correct location
        focus.select('.open-top')
            .attr('x1', xScale2(brush.extent()[0]))
            .attr('y1', yScale(scaleBg(30)))
            .attr('x2', xScale2(brush.extent()[1]))
            .attr('y2', yScale(scaleBg(30)));

        // transition open-left line to correct location
        focus.select('.open-left')
            .attr('x1', xScale2(brush.extent()[0]))
            .attr('y1', focusHeight)
            .attr('x2', xScale2(brush.extent()[0]))
            .attr('y2', prevChartHeight);

        // transition open-right line to correct location
        focus.select('.open-right')
            .attr('x1', xScale2(brush.extent()[1]))
            .attr('y1', focusHeight)
            .attr('x2', xScale2(brush.extent()[1]))
            .attr('y2', prevChartHeight);

        focus.select('.now-line')
            .transition()
            .duration(UPDATE_TRANS_MS)
            .attr('x1', xScale(nowDate))
            .attr('y1', yScale(scaleBg(36)))
            .attr('x2', xScale(nowDate))
            .attr('y2', yScale(scaleBg(420)));

        context.select('.now-line')
            .transition()
            .attr('x1', xScale2(new Date(brush.extent()[1]- THIRTY_MINS_IN_MS)))
            .attr('y1', yScale2(scaleBg(36)))
            .attr('x2', xScale2(new Date(brush.extent()[1]- THIRTY_MINS_IN_MS)))
            .attr('y2', yScale2(scaleBg(420)));

        // update x axis
        focus.select('.x.axis')
            .call(xAxis);

        // add clipping path so that data stays within axis
        focusCircles.attr('clip-path', 'url(#clip)');

        function prepareTreatCircles(sel) {
            sel.attr('cx', function (d) { return xScale(d.created_at); })
                .attr('cy', function (d) { return yScale(scaledTreatmentBG(d)); })
                .attr('r', function () { return dotRadius('mbg'); })
                .attr('stroke-width', 2)
                .attr('stroke', function (d) { return d.glucose ? 'grey' : 'white'; })
                .attr('fill', function (d) { return d.glucose ? 'red' : 'grey'; });

            return sel;
        }

        try {

            //NOTE: treatments with insulin or carbs are drawn by drawTreatment()
            //TODO: integrate with drawTreatment()

            // bind up the focus chart data to an array of circles
            var treatCircles = focus.selectAll('rect').data(treatments.filter(function(treatment) {
                return !treatment.carbs && !treatment.insulin;
            }));

            // if already existing then transition each circle to its new position
            prepareTreatCircles(treatCircles.transition().duration(UPDATE_TRANS_MS));

            // if new circle then just display
            prepareTreatCircles(treatCircles.enter().append('circle'))
                .on('mouseover', function (d) {
                    tooltip.transition().duration(TOOLTIP_TRANS_MS).style('opacity', .9);
                    tooltip.html('<strong>Time:</strong> ' + formatTime(d.created_at) + '<br/>' +
                        (d.eventType ? '<strong>Treatment type:</strong> ' + d.eventType + '<br/>' : '') +
                        (d.glucose ? '<strong>BG:</strong> ' + d.glucose + (d.glucoseType ? ' (' + d.glucoseType + ')': '') + '<br/>' : '') +
                        (d.enteredBy ? '<strong>Entered by:</strong> ' + d.enteredBy + '<br/>' : '') +
                        (d.notes ? '<strong>Notes:</strong> ' + d.notes : '')
                    )
                    .style('left', (d3.event.pageX) + 'px')
                    .style('top', (d3.event.pageY - 28) + 'px');
                })
                .on('mouseout', function () {
                    tooltip.transition()
                        .duration(TOOLTIP_TRANS_MS)
                        .style('opacity', 0);
                });
            
            treatCircles.attr('clip-path', 'url(#clip)');
        } catch (err) {
            console.error(err);
        }
    }

    // called for initial update and updates for resize
    function updateChart(init) {

        // get current data range
        var dataRange = d3.extent(data, dateFn);

        // get the entire container height and width subtracting the padding
        var chartWidth = (document.getElementById('chartContainer')
            .getBoundingClientRect().width) - padding.left - padding.right;

        var chartHeight = (document.getElementById('chartContainer')
            .getBoundingClientRect().height) - padding.top - padding.bottom;

        // get the height of each chart based on its container size ratio
        focusHeight = chartHeight * .7;
        contextHeight = chartHeight * .2;

        // get current brush extent
        var currentBrushExtent = brush.extent();

        // only redraw chart if chart size has changed
        if ((prevChartWidth != chartWidth) || (prevChartHeight != chartHeight)) {

            prevChartWidth = chartWidth;
            prevChartHeight = chartHeight;

            //set the width and height of the SVG element
            charts.attr('width', chartWidth + padding.left + padding.right)
                .attr('height', chartHeight + padding.top + padding.bottom);

            // ranges are based on the width and height available so reset
            xScale.range([0, chartWidth]);
            xScale2.range([0, chartWidth]);
            yScale.range([focusHeight, 0]);
            yScale2.range([chartHeight, chartHeight - contextHeight]);

            if (init) {

                // if first run then just display axis with no transition
                focus.select('.x')
                    .attr('transform', 'translate(0,' + focusHeight + ')')
                    .call(xAxis);

                focus.select('.y')
                    .attr('transform', 'translate(' + chartWidth + ',0)')
                    .call(yAxis);

                // if first run then just display axis with no transition
                context.select('.x')
                    .attr('transform', 'translate(0,' + chartHeight + ')')
                    .call(xAxis2);

                context.append('g')
                    .attr('class', 'x brush')
                    .call(d3.svg.brush().x(xScale2).on('brush', brushed))
                    .selectAll('rect')
                    .attr('y', focusHeight)
                    .attr('height', chartHeight - focusHeight);

                // disable resizing of brush
                d3.select('.x.brush').select('.background').style('cursor', 'move');
                d3.select('.x.brush').select('.resize.e').style('cursor', 'move');
                d3.select('.x.brush').select('.resize.w').style('cursor', 'move');

                // create a clipPath for when brushing
                clip = charts.append('defs')
                    .append('clipPath')
                    .attr('id', 'clip')
                    .append('rect')
                    .attr('height', chartHeight)
                    .attr('width', chartWidth);

                // add a line that marks the current time
                focus.append('line')
                    .attr('class', 'now-line')
                    .attr('x1', xScale(new Date(now)))
                    .attr('y1', yScale(scaleBg(36)))
                    .attr('x2', xScale(new Date(now)))
                    .attr('y2', yScale(scaleBg(420)))
                    .style('stroke-dasharray', ('3, 3'))
                    .attr('stroke', 'grey');

                // add a y-axis line that shows the high bg threshold
                focus.append('line')
                    .attr('class', 'high-line')
                    .attr('x1', xScale(dataRange[0]))
                    .attr('y1', yScale(scaleBg(app.thresholds.bg_high)))
                    .attr('x2', xScale(dataRange[1]))
                    .attr('y2', yScale(scaleBg(app.thresholds.bg_high)))
                    .style('stroke-dasharray', ('1, 6'))
                    .attr('stroke', '#777');

                // add a y-axis line that shows the high bg threshold
                focus.append('line')
                    .attr('class', 'target-top-line')
                    .attr('x1', xScale(dataRange[0]))
                    .attr('y1', yScale(scaleBg(app.thresholds.bg_target_top)))
                    .attr('x2', xScale(dataRange[1]))
                    .attr('y2', yScale(scaleBg(app.thresholds.bg_target_top)))
                    .style('stroke-dasharray', ('3, 3'))
                    .attr('stroke', 'grey');

                // add a y-axis line that shows the low bg threshold
                focus.append('line')
                    .attr('class', 'target-bottom-line')
                    .attr('x1', xScale(dataRange[0]))
                    .attr('y1', yScale(scaleBg(app.thresholds.bg_target_bottom)))
                    .attr('x2', xScale(dataRange[1]))
                    .attr('y2', yScale(scaleBg(app.thresholds.bg_target_bottom)))
                    .style('stroke-dasharray', ('3, 3'))
                    .attr('stroke', 'grey');

                // add a y-axis line that shows the low bg threshold
                focus.append('line')
                    .attr('class', 'low-line')
                    .attr('x1', xScale(dataRange[0]))
                    .attr('y1', yScale(scaleBg(app.thresholds.bg_low)))
                    .attr('x2', xScale(dataRange[1]))
                    .attr('y2', yScale(scaleBg(app.thresholds.bg_low)))
                    .style('stroke-dasharray', ('1, 6'))
                    .attr('stroke', '#777');

                // add a y-axis line that opens up the brush extent from the context to the focus
                focus.append('line')
                    .attr('class', 'open-top')
                    .attr('stroke', 'black')
                    .attr('stroke-width', 2);

                // add a x-axis line that closes the the brush container on left side
                focus.append('line')
                    .attr('class', 'open-left')
                    .attr('stroke', 'white');

                // add a x-axis line that closes the the brush container on right side
                focus.append('line')
                    .attr('class', 'open-right')
                    .attr('stroke', 'white');

                // add a line that marks the current time
                context.append('line')
                    .attr('class', 'now-line')
                    .attr('x1', xScale(new Date(now)))
                    .attr('y1', yScale2(scaleBg(36)))
                    .attr('x2', xScale(new Date(now)))
                    .attr('y2', yScale2(scaleBg(420)))
                    .style('stroke-dasharray', ('3, 3'))
                    .attr('stroke', 'grey');

                // add a y-axis line that shows the high bg threshold
                context.append('line')
                    .attr('class', 'high-line')
                    .attr('x1', xScale(dataRange[0]))
                    .attr('y1', yScale2(scaleBg(app.thresholds.bg_target_top)))
                    .attr('x2', xScale(dataRange[1]))
                    .attr('y2', yScale2(scaleBg(app.thresholds.bg_target_top)))
                    .style('stroke-dasharray', ('3, 3'))
                    .attr('stroke', 'grey');

                // add a y-axis line that shows the low bg threshold
                context.append('line')
                    .attr('class', 'low-line')
                    .attr('x1', xScale(dataRange[0]))
                    .attr('y1', yScale2(scaleBg(app.thresholds.bg_target_bottom)))
                    .attr('x2', xScale(dataRange[1]))
                    .attr('y2', yScale2(scaleBg(app.thresholds.bg_target_bottom)))
                    .style('stroke-dasharray', ('3, 3'))
                    .attr('stroke', 'grey');

            } else {

                // for subsequent updates use a transition to animate the axis to the new position
                var focusTransition = focus.transition().duration(UPDATE_TRANS_MS);

                focusTransition.select('.x')
                    .attr('transform', 'translate(0,' + focusHeight + ')')
                    .call(xAxis);

                focusTransition.select('.y')
                    .attr('transform', 'translate(' + chartWidth + ', 0)')
                    .call(yAxis);

                var contextTransition = context.transition().duration(UPDATE_TRANS_MS);

                contextTransition.select('.x')
                    .attr('transform', 'translate(0,' + chartHeight + ')')
                    .call(xAxis2);

                // reset clip to new dimensions
                clip.transition()
                    .attr('width', chartWidth)
                    .attr('height', chartHeight);

                // reset brush location
                context.select('.x.brush')
                    .selectAll('rect')
                    .attr('y', focusHeight)
                    .attr('height', chartHeight - focusHeight);

                // clear current brush
                d3.select('.brush').call(brush.clear());

                // redraw old brush with new dimensions
                d3.select('.brush').transition().duration(UPDATE_TRANS_MS).call(brush.extent(currentBrushExtent));

                // transition lines to correct location
                focus.select('.high-line')
                    .transition()
                    .duration(UPDATE_TRANS_MS)
                    .attr('x1', xScale(currentBrushExtent[0]))
                    .attr('y1', yScale(scaleBg(app.thresholds.bg_high)))
                    .attr('x2', xScale(currentBrushExtent[1]))
                    .attr('y2', yScale(scaleBg(app.thresholds.bg_high)));

                focus.select('.target-top-line')
                    .transition()
                    .duration(UPDATE_TRANS_MS)
                    .attr('x1', xScale(currentBrushExtent[0]))
                    .attr('y1', yScale(scaleBg(app.thresholds.bg_target_top)))
                    .attr('x2', xScale(currentBrushExtent[1]))
                    .attr('y2', yScale(scaleBg(app.thresholds.bg_target_top)));

                focus.select('.target-bottom-line')
                    .transition()
                    .duration(UPDATE_TRANS_MS)
                    .attr('x1', xScale(currentBrushExtent[0]))
                    .attr('y1', yScale(scaleBg(app.thresholds.bg_target_bottom)))
                    .attr('x2', xScale(currentBrushExtent[1]))
                    .attr('y2', yScale(scaleBg(app.thresholds.bg_target_bottom)));

                focus.select('.low-line')
                    .transition()
                    .duration(UPDATE_TRANS_MS)
                    .attr('x1', xScale(currentBrushExtent[0]))
                    .attr('y1', yScale(scaleBg(app.thresholds.bg_low)))
                    .attr('x2', xScale(currentBrushExtent[1]))
                    .attr('y2', yScale(scaleBg(app.thresholds.bg_low)));

                // transition open-top line to correct location
                focus.select('.open-top')
                    .transition()
                    .duration(UPDATE_TRANS_MS)
                    .attr('x1', xScale2(currentBrushExtent[0]))
                    .attr('y1', yScale(scaleBg(30)))
                    .attr('x2', xScale2(currentBrushExtent[1]))
                    .attr('y2', yScale(scaleBg(30)));

                // transition open-left line to correct location
                focus.select('.open-left')
                    .transition()
                    .duration(UPDATE_TRANS_MS)
                    .attr('x1', xScale2(currentBrushExtent[0]))
                    .attr('y1', focusHeight)
                    .attr('x2', xScale2(currentBrushExtent[0]))
                    .attr('y2', chartHeight);

                // transition open-right line to correct location
                focus.select('.open-right')
                    .transition()
                    .duration(UPDATE_TRANS_MS)
                    .attr('x1', xScale2(currentBrushExtent[1]))
                    .attr('y1', focusHeight)
                    .attr('x2', xScale2(currentBrushExtent[1]))
                    .attr('y2', chartHeight);

                // transition high line to correct location
                context.select('.high-line')
                    .transition()
                    .duration(UPDATE_TRANS_MS)
                    .attr('x1', xScale2(dataRange[0]))
                    .attr('y1', yScale2(scaleBg(app.thresholds.bg_target_top)))
                    .attr('x2', xScale2(dataRange[1]))
                    .attr('y2', yScale2(scaleBg(app.thresholds.bg_target_top)));

                // transition low line to correct location
                context.select('.low-line')
                    .transition()
                    .duration(UPDATE_TRANS_MS)
                    .attr('x1', xScale2(dataRange[0]))
                    .attr('y1', yScale2(scaleBg(app.thresholds.bg_target_bottom)))
                    .attr('x2', xScale2(dataRange[1]))
                    .attr('y2', yScale2(scaleBg(app.thresholds.bg_target_bottom)));
            }
        }

        // update domain
        xScale2.domain(dataRange);

        // only if a user brush is not active, update brush and focus chart with recent data
        // else, just transition brush
        var updateBrush = d3.select('.brush').transition().duration(UPDATE_TRANS_MS);
        if (!brushInProgress) {
            updateBrush
                .call(brush.extent([new Date(dataRange[1].getTime() - FOCUS_DATA_RANGE_MS), dataRange[1]]));
            brushed(true);
        } else {
            updateBrush
                .call(brush.extent([currentBrushExtent[0], currentBrushExtent[1]]));
            brushed(true);
        }

        // bind up the context chart data to an array of circles
        var contextCircles = context.selectAll('circle')
            .data(data);

        function prepareContextCircles(sel) {
            sel.attr('cx', function (d) { return xScale2(d.date); })
                .attr('cy', function (d) { return yScale2(d.sgv); })
                .attr('fill', function (d) { return d.color; })
                .style('opacity', function (d) { return highlightBrushPoints(d) })
                .attr('stroke-width', function (d) {if (d.type == 'mbg') return 2; else return 0; })
                .attr('stroke', function (d) { return 'white'; })
                .attr('r', function(d) { if (d.type == 'mbg') return 4; else return 2;});

            return sel;
        }

        // if already existing then transition each circle to its new position
        prepareContextCircles(contextCircles.transition().duration(UPDATE_TRANS_MS));

        // if new circle then just display
        prepareContextCircles(contextCircles.enter().append('circle'));

        contextCircles.exit()
            .remove();

        // update x axis domain
        context.select('.x')
            .call(xAxis2);
    }

    function sgvToColor(sgv) {
        var color = 'grey';

        if (browserSettings.theme == 'colors') {
            if (sgv > app.thresholds.bg_high) {
                color = 'red';
            } else if (sgv > app.thresholds.bg_target_top) {
                color = 'yellow';
            } else if (sgv >= app.thresholds.bg_target_bottom && sgv <= app.thresholds.bg_target_top) {
                color = '#4cff00';
            } else if (sgv < app.thresholds.bg_low) {
                color = 'red';
            } else if (sgv < app.thresholds.bg_target_bottom) {
                color = 'yellow';
            }
        }

        return color;
    }

    function generateAlarm(file) {
        alarmInProgress = true;
        var selector = '.audio.alarms audio.' + file;
        d3.select(selector).each(function (d, i) {
            var audio = this;
            playAlarm(audio);
            $(this).addClass('playing');
        });
        var bgButton = $('#bgButton');
        bgButton.show();
        bgButton.toggleClass('urgent', file == urgentAlarmSound);
        var noButton = $('#noButton');
        noButton.hide();
        $('#container').addClass('alarming');
        $('.container .currentBG').text();

    }

    function playAlarm(audio) {
        // ?mute=true disables alarms to testers.
        if (querystring.mute != 'true') {
            audio.play();
        } else {
            showNotification('Alarm was muted (?mute=true)');
        }
    }

    function stopAlarm(isClient, silenceTime) {
        alarmInProgress = false;
        var bgButton = $('#bgButton');
        bgButton.hide();
        var noButton = $('#noButton');
        noButton.show();
        d3.selectAll('audio.playing').each(function (d, i) {
            var audio = this;
            audio.pause();
            $(this).removeClass('playing');
        });

        $('#container').removeClass('alarming');

        // only emit ack if client invoke by button press
        if (isClient) {
            socket.emit('ack', currentAlarmType || 'alarm', silenceTime);
            brushed(false);
        }
    }

    function timeAgo(offset) {
        var parts = {},
            MINUTE = 60,
            HOUR = 3600,
            DAY = 86400,
            WEEK = 604800;

        //offset = (MINUTE * MINUTES_SINCE_LAST_UPDATE_WARN) + 60
        //offset = (MINUTE * MINUTES_SINCE_LAST_UPDATE_URGENT) + 60

        if (offset <= MINUTE)              parts = { label: 'now' };
        if (offset <= MINUTE * 2)          parts = { label: '1 min ago' };
        else if (offset < (MINUTE * 60))   parts = { value: Math.round(Math.abs(offset / MINUTE)), label: 'mins' };
        else if (offset < (HOUR * 2))      parts = { label: '1 hr ago' };
        else if (offset < (HOUR * 24))     parts = { value: Math.round(Math.abs(offset / HOUR)), label: 'hrs' };
        else if (offset < DAY)             parts = { label: '1 day ago' };
        else if (offset < (DAY * 7))       parts = { value: Math.round(Math.abs(offset / DAY)), label: 'day' };
        else if (offset < (WEEK * 52))     parts = { value: Math.round(Math.abs(offset / WEEK)), label: 'week' };
        else                               parts = { label: 'a long time ago' };

        if (offset > (MINUTE * MINUTES_SINCE_LAST_UPDATE_URGENT)) {
            var lastEntry = $('#lastEntry');
            lastEntry.removeClass('warn');
            lastEntry.addClass('urgent');

            $('.bgStatus').removeClass('current');
        } else if (offset > (MINUTE * MINUTES_SINCE_LAST_UPDATE_WARN)) {
            var lastEntry = $('#lastEntry');
            lastEntry.removeClass('urgent');
            lastEntry.addClass('warn');
        } else {
            $('.bgStatus').addClass('current');
            $('#lastEntry').removeClass('warn urgent');
        }

        if (parts.value)
            return parts.value + ' ' + parts.label + ' ago';
        else
            return parts.label;

    }

    function calcBGByTime(time) {
        var closeBGs = data.filter(function(d) {
            if (!d.y) {
                return false;
            } else {
                return Math.abs((new Date(d.date)).getTime() - time) <= SIX_MINS_IN_MS;
            }
        });

        var totalBG = 0;
        closeBGs.forEach(function(d) {
            totalBG += d.y;
        });

        return totalBG ? (totalBG / closeBGs.length) : 450;
    }

    function scaledTreatmentBG(treatment) {
        //TODO: store units in db per treatment, and use that for conversion, until then assume glucose doesn't need to be scaled
        //      Care Portal treatment form does ask for the display units to be used
        //      other option is to convert on entry, but then need to correctly identify/handel old data
        return treatment.glucose || scaleBg(calcBGByTime(treatment.created_at.getTime()));
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //draw a compact visualization of a treatment (carbs, insulin)
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function drawTreatment(treatment, scale, showValues) {

        if (!treatment.carbs && !treatment.insulin) return;

        var CR = treatment.CR || 20;
        var carbs = treatment.carbs || CR;
        var insulin = treatment.insulin || 1;

        var R1 = Math.sqrt(Math.min(carbs, insulin * CR)) / scale,
            R2 = Math.sqrt(Math.max(carbs, insulin * CR)) / scale,
            R3 = R2 + 8 / scale;

        var arc_data = [
            { 'element': '', 'color': 'white', 'start': -1.5708, 'end': 1.5708, 'inner': 0, 'outer': R1 },
            { 'element': '', 'color': 'transparent', 'start': -1.5708, 'end': 1.5708, 'inner': R2, 'outer': R3 },
            { 'element': '', 'color': '#0099ff', 'start': 1.5708, 'end': 4.7124, 'inner': 0, 'outer': R1 },
            { 'element': '', 'color': 'transparent', 'start': 1.5708, 'end': 4.7124, 'inner': R2, 'outer': R3 }
        ];

        arc_data[0].outlineOnly = !treatment.carbs;
        arc_data[2].outlineOnly = !treatment.insulin;

        if (treatment.carbs > 0) arc_data[1].element = Math.round(treatment.carbs) + ' g';
        if (treatment.insulin > 0) arc_data[3].element = Math.round(treatment.insulin * 100) / 100 + ' U';

        var arc = d3.svg.arc()
            .innerRadius(function (d) { return 5 * d.inner; })
            .outerRadius(function (d) { return 5 * d.outer; })
            .endAngle(function (d) { return d.start; })
            .startAngle(function (d) { return d.end; });

        var treatmentDots = focus.selectAll('treatment-dot')
            .data(arc_data)
            .enter()
            .append('g')
            .attr('transform', 'translate(' + xScale(treatment.created_at.getTime()) + ', ' + yScale(scaledTreatmentBG(treatment)) + ')')
            .on('mouseover', function () {
                tooltip.transition().duration(TOOLTIP_TRANS_MS).style('opacity', .9);
                tooltip.html('<strong>Time:</strong> ' + formatTime(treatment.created_at) + '<br/>' + '<strong>Treatment type:</strong> ' + treatment.eventType + '<br/>' +
                        (treatment.carbs ? '<strong>Carbs:</strong> ' + treatment.carbs + '<br/>' : '') +
                        (treatment.insulin ? '<strong>Insulin:</strong> ' + treatment.insulin + '<br/>' : '') +
                        (treatment.glucose ? '<strong>BG:</strong> ' + treatment.glucose + (treatment.glucoseType ? ' (' + treatment.glucoseType + ')': '') + '<br/>' : '') +
                        (treatment.enteredBy ? '<strong>Entered by:</strong> ' + treatment.enteredBy + '<br/>' : '') +
                        (treatment.notes ? '<strong>Notes:</strong> ' + treatment.notes : '')
                )
                .style('left', (d3.event.pageX) + 'px')
                .style('top', (d3.event.pageY - 28) + 'px');
            })
            .on('mouseout', function () {
                tooltip.transition()
                    .duration(TOOLTIP_TRANS_MS)
                    .style('opacity', 0);
            });
        var arcs = treatmentDots.append('path')
            .attr('class', 'path')
            .attr('fill', function (d, i) { if (d.outlineOnly) return 'transparent'; else return d.color; })
            .attr('stroke-width', function (d) {if (d.outlineOnly) return 1; else return 0; })
            .attr('stroke', function (d) { return d.color; })
            .attr('id', function (d, i) { return 's' + i; })
            .attr('d', arc);


        // labels for carbs and insulin
        if (showValues) {
            var label = treatmentDots.append('g')
                .attr('class', 'path')
                .attr('id', 'label')
                .style('fill', 'white');
            label.append('text')
                .style('font-size', 30 / scale)
                .style('font-family', 'Arial')
                .style('text-shadow', '0px 0px 10px rgba(0, 0, 0, 1)')
                .attr('text-anchor', 'middle')
                .attr('dy', '.35em')
                .attr('transform', function (d) {
                    d.outerRadius = d.outerRadius * 2.1;
                    d.innerRadius = d.outerRadius * 2.1;
                    return 'translate(' + arc.centroid(d) + ')';
                })
                .text(function (d) { return d.element; });
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // function to predict
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function predictAR(actual, lookback) {
        var ONE_MINUTE = 60 * 1000;
        var FIVE_MINUTES = 5 * ONE_MINUTE;
        var predicted = [];
        var BG_REF = scaleBg(140);
        var BG_MIN = scaleBg(36);
        var BG_MAX = scaleBg(400);

        function roundByUnits(value) {
            if (browserSettings.units == 'mmol') {
                return value.toFixed(1);
            } else {
                return Math.round(value);
            }
        }

        // these are the one sigma limits for the first 13 prediction interval uncertainties (65 minutes)
        var CONE = [0.020, 0.041, 0.061, 0.081, 0.099, 0.116, 0.132, 0.146, 0.159, 0.171, 0.182, 0.192, 0.201];
        // these are modified to make the cone much blunter
        //var CONE = [0.030, 0.060, 0.090, 0.120, 0.140, 0.150, 0.160, 0.170, 0.180, 0.185, 0.190, 0.195, 0.200];
        // for testing
        //var CONE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        if (actual.length < lookback+1) {
            var y = [Math.log(actual[actual.length-1].sgv / BG_REF), Math.log(actual[actual.length-1].sgv / BG_REF)];
        } else {
            var elapsedMins = (actual[actual.length-1].date - actual[actual.length-1-lookback].date) / ONE_MINUTE;
            // construct a '5m ago' sgv offset from current sgv by the average change over the lookback interval
            var lookbackSgvChange = actual[lookback].sgv-actual[0].sgv;
            var fiveMinAgoSgv = actual[lookback].sgv - lookbackSgvChange/elapsedMins*5;
            y = [Math.log(fiveMinAgoSgv / BG_REF), Math.log(actual[lookback].sgv / BG_REF)];
            /*
            if (elapsedMins < lookback * 5.1) {
                y = [Math.log(actual[0].sgv / BG_REF), Math.log(actual[lookback].sgv / BG_REF)];
            } else {
                y = [Math.log(actual[lookback].sgv / BG_REF), Math.log(actual[lookback].sgv / BG_REF)];
            }
            */
        }
        var AR = [-0.723, 1.716];
        var dt = actual[lookback].date.getTime();
        var predictedColor = 'blue';
        if (browserSettings.theme == 'colors') {
            predictedColor = 'cyan';
        }
        for (var i = 0; i < CONE.length; i++) {
            y = [y[1], AR[0] * y[0] + AR[1] * y[1]];
            dt = dt + FIVE_MINUTES;
            // Add 2000 ms so not same point as SG
            predicted[i * 2] = {
                date: new Date(dt + 2000),
                sgv: Math.max(BG_MIN, Math.min(BG_MAX, roundByUnits(BG_REF * Math.exp((y[1] - 2 * CONE[i]))))),
                color: predictedColor
            };
            // Add 4000 ms so not same point as SG
            predicted[i * 2 + 1] = {
                date: new Date(dt + 4000),
                sgv: Math.max(BG_MIN, Math.min(BG_MAX, roundByUnits(BG_REF * Math.exp((y[1] + 2 * CONE[i]))))),
                color: predictedColor
            };
            predicted.forEach(function (d) {
                d.type = 'forecast';
                if (d.sgv < BG_MIN)
                    d.color = 'transparent';
            })
        }
        return predicted;
    }

    function updateClock() {
        updateClockDisplay();
        var interval = (60 - (new Date()).getSeconds()) * 1000 + 5;
        setTimeout(updateClock,interval);

        updateTimeAgo();

        // Dim the screen by reducing the opacity when at nighttime
        if (browserSettings.nightMode) {
            var dateTime = new Date();
            if (opacity.current != opacity.NIGHT && (dateTime.getHours() > 21 || dateTime.getHours() < 7)) {
                $('body').css({ 'opacity': opacity.NIGHT });
            } else {
                $('body').css({ 'opacity': opacity.DAY });
            }
        }
    }

    function updateClockDisplay() {
        if (inRetroMode()) return;
        now = Date.now();
        var dateTime = new Date(now);
        $('#currentTime').text(formatTime(dateTime)).css('text-decoration', '');
    }

    function updateTimeAgo() {
        if (!latestSGV || inRetroMode()) return;

        if (latestSGV.y < 39) {
            $('#lastEntry').text('CGM ERROR').removeClass('current').addClass('urgent');
        } else {
            var secsSinceLast = (Date.now() - new Date(latestSGV.x).getTime()) / 1000;
            $('#lastEntry').text(timeAgo(secsSinceLast)).toggleClass('current', secsSinceLast < 10 * 60);
        }
    }

    function init() {

        jqWindow = $(window);

        tooltip = d3.select('body').append('div')
            .attr('class', 'tooltip')
            .style('opacity', 0);

        // Tick Values
        if (browserSettings.units == 'mmol') {
            tickValues = [
                  2.0
                , Math.round(scaleBg(app.thresholds.bg_low))
                , Math.round(scaleBg(app.thresholds.bg_target_bottom))
                , 6.0
                , Math.round(scaleBg(app.thresholds.bg_target_top))
                , Math.round(scaleBg(app.thresholds.bg_high))
                , 22.0
            ];
        } else {
            tickValues = [
                  40
                , app.thresholds.bg_low
                , app.thresholds.bg_target_bottom
                , 120
                , app.thresholds.bg_target_top
                , app.thresholds.bg_high
                , 400
            ];
        }

        futureOpacity = d3.scale.linear( )
            .domain([TWENTY_FIVE_MINS_IN_MS, SIXTY_MINS_IN_MS])
            .range([0.8, 0.1]);

        // create svg and g to contain the chart contents
        charts = d3.select('#chartContainer').append('svg')
            .append('g')
            .attr('class', 'chartContainer')
            .attr('transform', 'translate(' + padding.left + ',' + padding.top + ')');

        focus = charts.append('g');

        // create the x axis container
        focus.append('g')
            .attr('class', 'x axis');

        // create the y axis container
        focus.append('g')
            .attr('class', 'y axis');

        context = charts.append('g');

        // create the x axis container
        context.append('g')
            .attr('class', 'x axis');

        // create the y axis container
        context.append('g')
            .attr('class', 'y axis');

        // look for resize but use timer to only call the update script when a resize stops
        var resizeTimer;
        window.onresize = function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                updateChart(false);
            }, 100);
        };

        updateClock();

        var silenceDropdown = new Dropdown('.dropdown-menu');

        $('#bgButton').click(function (e) {
            silenceDropdown.open(e);
        });

        $('#silenceBtn').find('a').click(function (e) {
            stopAlarm(true, $(this).data('snooze-time'));
            e.preventDefault();
        });

        ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
        // Client-side code to connect to server and handle incoming data
        ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
        socket = io.connect();

        socket.on('sgv', function (d) {
            if (d.length > 1) {
                // change the next line so that it uses the prediction if the signal gets lost (max 1/2 hr)
                if (d[0].length) {
                    latestUpdateTime = Date.now();
                    latestSGV = d[0][d[0].length - 1];
                    prevSGV = d[0][d[0].length - 2];
                }

                treatments = d[3];
                treatments.forEach(function (d) {
                    d.created_at = new Date(d.created_at);
                });

                cal = d[4][d[4].length-1];


                var temp1 = [ ];
                if (cal && showRawBGs()) {
                    temp1 = d[0].map(function (entry) {
                        var rawBg = rawIsigToRawBg(entry, cal);
                        return { date: new Date(entry.x - 2 * 1000), y: rawBg, sgv: scaleBg(rawBg), color: 'white', type: 'rawbg'}
                    }).filter(function(entry) { return entry.y > 0});
                }
                var temp2 = d[0].map(function (obj) {
                    return { date: new Date(obj.x), y: obj.y, sgv: scaleBg(obj.y), direction: obj.direction, color: sgvToColor(obj.y), type: 'sgv', noise: obj.noise}
                });
                data = [];
                data = data.concat(temp1, temp2);

                // TODO: This is a kludge to advance the time as data becomes stale by making old predictor clear (using color = 'none')
                // This shouldn't have to be sent and can be fixed by using xScale.domain([x0,x1]) function with
                // 2 days before now as x0 and 30 minutes from now for x1 for context plot, but this will be
                // required to happen when 'now' event is sent from websocket.js every minute.  When fixed,
                // remove all 'color != 'none'' code
                data = data.concat(d[1].map(function (obj) { return { date: new Date(obj.x), y: obj.y, sgv: scaleBg(obj.y), color: 'none', type: 'server-forecast'} }));

                //Add MBG's also, pretend they are SGV's
                data = data.concat(d[2].map(function (obj) { return { date: new Date(obj.x), y: obj.y, sgv: scaleBg(obj.y), color: 'red', type: 'mbg', device: obj.device } }));

                data.forEach(function (d) {
                    if (d.y < 39)
                        d.color = 'transparent';
                });

                if (!isInitialData) {
                    isInitialData = true;
                    initializeCharts();
                }
                else {
                    updateChart(false);
                }
            }
        });

        ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
        // Alarms and Text handling
        ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
        socket.on('connect', function () {
            console.log('Client connected to server.')
        });

        //with predicted alarms, latestSGV may still be in target so to see if the alarm
        //  is for a HIGH we can only check if it's >= the bottom of the target
        function isAlarmForHigh() {
            return latestSGV.y >= app.thresholds.bg_target_bottom;
        }

        //with predicted alarms, latestSGV may still be in target so to see if the alarm
        //  is for a LOW we can only check if it's <= the top of the target
        function isAlarmForLow() {
            return latestSGV.y <= app.thresholds.bg_target_top;
        }

        socket.on('alarm', function () {
            console.info('alarm received from server');
            var enabled = (isAlarmForHigh() && browserSettings.alarmHigh) || (isAlarmForLow() && browserSettings.alarmLow);
            if (enabled) {
                console.log('Alarm raised!');
                currentAlarmType = 'alarm';
                generateAlarm(alarmSound);
            } else {
                console.info('alarm was disabled locally', latestSGV.y, browserSettings);
            }
            brushInProgress = false;
            updateChart(false);
        });
        socket.on('urgent_alarm', function () {
            console.info('urgent alarm received from server');
            var enabled = (isAlarmForHigh() && browserSettings.alarmUrgentHigh) || (isAlarmForLow() && browserSettings.alarmUrgentLow);
            if (enabled) {
                console.log('Urgent alarm raised!');
                currentAlarmType = 'urgent_alarm';
                generateAlarm(urgentAlarmSound);
            } else {
                console.info('urgent alarm was disabled locally', latestSGV.y, browserSettings);
            }
            brushInProgress = false;
            updateChart(false);
        });
        socket.on('clear_alarm', function () {
            if (alarmInProgress) {
                console.log('clearing alarm');
                stopAlarm();
            }
        });


        $('#testAlarms').click(function(event) {
            d3.selectAll('.audio.alarms audio').each(function () {
                var audio = this;
                playAlarm(audio);
                setTimeout(function() {
                    audio.pause();
                }, 4000);
            });
            event.preventDefault();
        });
    }

    $.ajax('/api/v1/status.json', {
        success: function (xhr) {
            app = { name: xhr.name
                , version: xhr.version
                , head: xhr.head
                , apiEnabled: xhr.apiEnabled
                , enabledOptions: xhr.enabledOptions || ''
                , thresholds: xhr.thresholds
                , alarm_types: xhr.alarm_types
                , units: xhr.units
                , careportalEnabled: xhr.careportalEnabled
            };
        }
    }).done(function() {
        $('.appName').text(app.name);
        $('.version').text(app.version);
        $('.head').text(app.head);
        if (app.apiEnabled) {
            $('.serverSettings').show();
        }
        $('#treatmentDrawerToggle').toggle(app.careportalEnabled);
        browserSettings = getBrowserSettings(browserStorage);
        init();
    });

})();
