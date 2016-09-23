/**
 * @providesModule LightboxOverlay
 */
'use strict';

var React = require('react');
var {
    PropTypes,
} = React;
var {
    Animated,
    Dimensions,
    Modal,
    PanResponder,
    Platform,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} = require('react-native');

//var WINDOW_HEIGHT = Dimensions.get('window').height;
//var WINDOW_WIDTH = Dimensions.get('window').width;
var DRAG_DISMISS_THRESHOLD = 150;
var STATUS_BAR_OFFSET = (Platform.OS === 'android' ? -25 : 0);

const DOUBLE_TAP_INTERVAL = 500;
const DOUBLE_TAP_LOCATION_THRESHOLD = 10;

var LightboxOverlay = React.createClass({
    propTypes: {
        origin: PropTypes.shape({
            x:        PropTypes.number,
            y:        PropTypes.number,
            width:    PropTypes.number,
            height:   PropTypes.number,
        }),
        springConfig: PropTypes.shape({
            tension:  PropTypes.number,
            friction: PropTypes.number,
        }),
        backgroundColor: PropTypes.string,
        isOpen:          PropTypes.bool,
        renderHeader:    PropTypes.func,
        onOpen:          PropTypes.func,
        onClose:         PropTypes.func,
        swipeToDismiss:  PropTypes.bool,
        
        focusedChildIndex:   PropTypes.number,
        onFocusedChildIndex: PropTypes.func,
    },

    getInitialState: function() {
        return {
            isAnimating: false,
            isPanning: false,
            panDirection: null,
            target: {
                x: 0,
                y: 0,
                opacity: 1,
            },
            windowWidth: 0,
            windowHeight: 0,
            pan: new Animated.ValueXY(),
            carouselOffset: 0,
            openVal: new Animated.Value(0),
            focusedChildIndex: this.props.focusedChildIndex || 0,
        };
    },

    getDefaultProps: function() {
        return {
            springConfig: { tension: 30, friction: 7 },
            backgroundColor: 'black',
        };
    },

    onOrientationChange: function(orientation) {
        this.setState({
            windowWidth: SCREEN_WIDTH(),
            windowHeight: SCREEN_HEIGHT(),
        },() => {
            //Re-center all the image ScrollViews
            this.props.images.forEach((image,index) => {
                var scrollView = this.refs['overlay_image_slide_'+index];
                if (scrollView) {
                    setTimeout(()=>this._centerScrollViewAndResetZoom(scrollView,image),0);
                }
            });
        });
    },

    _centerScrollViewAndResetZoom: function(scrollView,imageData) {
        scrollView.scrollResponderZoomTo({
            y:0,
            x:0,
            width: imageData.width,
            height: imageData.height,
            animated: true,
        });
        scrollView.scrollTo({
            x:((SCREEN_WIDTH()-imageData.width) * -0.5) || 0,
            y:((SCREEN_HEIGHT()-imageData.height) * -0.5) || 0,
        });
    },
    
    componentWillMount: function() {
        this._panResponder = PanResponder.create({
            // Ask to be the responder:
            onStartShouldSetPanResponder: (evt, gestureState) => !this.state.isAnimating && this.props.swipeToDismiss,
            onStartShouldSetPanResponderCapture: (evt, gestureState) => !this.state.isAnimating && this.props.swipeToDismiss,
            onMoveShouldSetPanResponder: (evt, gestureState) => !this.state.isAnimating && this.props.swipeToDismiss,
            onMoveShouldSetPanResponderCapture: (evt, gestureState) => !this.state.isAnimating && this.props.swipeToDismiss,
            onPanResponderGrant: (evt, gestureState) => {
                this.state.pan.y.setValue(0);
                this.setState({ isPanning: true });
            },
            onPanResponderMove: (evt, gestureState) => {
                if (!this.state.panDirection) {
                    if (Math.abs(gestureState.dx) > Math.abs(gestureState.dy)) {
                        this.state.panDirection = 'horizontal';
                        //this.setState({panDirection:'horizontal'});
                    } else {
                        this.state.panDirection = 'vertical';
                        //this.setState({panDirection:'vertical'});
                    }
                }
                if (this.state.panDirection == 'vertical') {
                    Animated.event([
                        null,
                        {
                            dy: this.state.pan.y,
                        }
                    ])(evt,gestureState);
                } else if (this.state.panDirection == 'horizontal') {
                    Animated.event([
                        null,
                        {
                            dx: this.state.pan.x,
                        }
                    ])(evt,gestureState);
                }
            },
            onPanResponderTerminationRequest: (evt, gestureState) => true,
            onPanResponderRelease: (evt, gestureState) => {
                var didDoubleTap = this._handleDoubleTap(evt,true);

                if (didDoubleTap) {
                    //double tap has priority, since we could be in the middle of sliding and miss the double tap.  The unresponsiveness of the UI would not be good for UX.
                    //we already double tapped, skip everything else.
                }
                //sliding up or down to close the lightbox.
                else if(this.state.panDirection == 'vertical' && Math.abs(gestureState.dy) > DRAG_DISMISS_THRESHOLD) {
                    this.setState({
                        isPanning: false,
                        panDirection: null,
                        target: {
                            y: gestureState.dy,
                            x: gestureState.dx,
                            opacity: 1 - Math.abs(gestureState.dy / this.state.windowHeight)
                        },
                    });
                    this.close();
                }
                //sliding up or down, but not enough to close the lightbox.
                else if (this.state.panDirection == 'vertical') {
                    Animated.spring(
                        this.state.pan.y,
                        {toValue: 0, ...this.props.springConfig}
                    ).start(() => { this.setState({ isPanning: false, panDirection:null }); });
                }
                else if (this.state.panDirection == 'horizontal') {
                    /*
                       Two situations where we want to pan to the next child:
                       1. If velocity is high enough
                       2. If dx is large enough
                     */
                    var NEXT_CHILD_OFFSET_THRESHOLD = Math.max(this.state.windowWidth * 0.2,50);
                    var NEXT_CHILD_VELOCITY_THRESHOLD = 1;
                    var targetOffset = null;
                    if ((gestureState.dx < -1 * NEXT_CHILD_OFFSET_THRESHOLD
                      || gestureState.vx < -1 * NEXT_CHILD_VELOCITY_THRESHOLD)
                            && this.state.focusedChildIndex < this.props.images.length-1
                    ) {
                        //Move to the next child
                        targetOffset = -1 * this.state.windowWidth;
                        this.state.focusedChildIndex += 1;
                    }
                    else if ((gestureState.dx > NEXT_CHILD_OFFSET_THRESHOLD
                           || gestureState.vx > NEXT_CHILD_VELOCITY_THRESHOLD)
                            && this.state.focusedChildIndex > 0
                    ) {
                        //Move to the previous child
                        targetOffset = this.state.windowWidth;
                        this.state.focusedChildIndex -= 1;
                    } else {
                        //Focused child does not change
                        targetOffset = 0;
                    }
                    Animated.spring(
                        this.state.pan.x,
                        {toValue: targetOffset, ...this.props.springConfig}
                    ).start(() => {
                        this.state.carouselOffset += targetOffset;
                        this.state.pan.x.setOffset(this.state.carouselOffset);
                        this.state.pan.x.setValue(0);
                        this.setState({ isPanning: false, panDirection:null });
                        if (this.props.onFocusedChildIndex) {
                            this.props.onFocusedChildIndex(this.state.focusedChildIndex);
                        }
                    });
                }
            },
        });
    },

    componentDidMount: function() {
        Device.initWithoutBind(this);
        this.setState({
            windowWidth: SCREEN_WIDTH(),
            windowHeight: SCREEN_HEIGHT(),
        });
        if(this.props.isOpen) {
            this.open();
        }
    },

    open: function() {
        StatusBar.setHidden(true, 'fade');

        this.state.pan.x.setValue(0);
        this.state.carouselOffset = -1 * (this.state.focusedChildIndex || 0) * this.state.windowWidth;
        this.state.pan.x.setOffset(this.state.carouselOffset);            
        
        this.state.pan.y.setValue(0);
        this.setState({
            isAnimating: true,
            target: {
                x: 0,
                y: 0,
                opacity: 1,
            }
        });

        Animated.spring(
            this.state.openVal,
            { toValue: 1, ...this.props.springConfig }
        ).start(() => this.setState({ isAnimating: false }));
    },

    close: function() {
        StatusBar.setHidden(false, 'fade');
        this.setState({
            isAnimating: true,
        });
        Animated.spring(
            this.state.openVal,
            { toValue: 0, ...this.props.springConfig }
        ).start(() => {
            this.setState({
                isAnimating: false,
            });
            this.props.onClose();
        });
    },

    componentWillReceiveProps: function(props) {
        if(this.props.isOpen != props.isOpen && props.isOpen) {
            this.open();
        }
        this.state.focusedChildIndex = props.focusedChildIndex || 0;
        
        this.state.pan.x.setValue(0);
        this.state.carouselOffset = -1 * (this.state.focusedChildIndex || 0) * this.state.windowWidth;
        this.state.pan.x.setOffset(this.state.carouselOffset);
        
    },

    //Handle a double tap to zoom in or out.  If we did zoom, return true.  Otherwise return false.
    _handleDoubleTap: function (evt,zoomIn) {
        let now = new Date().getTime();
        if (!this._lastPress) {
            this._lastPress = {
                timestamp:0,
                locationX:-999,
                locationY:-999
            }
        }
        let timeDelta = now - this._lastPress.timestamp;
        let didDoubleTap = false;
        if (timeDelta < DOUBLE_TAP_INTERVAL
         && Math.abs(this._lastPress.locationX - evt.nativeEvent.locationX) < DOUBLE_TAP_LOCATION_THRESHOLD
         && Math.abs(this._lastPress.locationY - evt.nativeEvent.locationY) < DOUBLE_TAP_LOCATION_THRESHOLD
         && evt.nativeEvent.changedTouches.length == 1
        ) {
            var currentScrollView = this.refs['overlay_image_slide_'+this.state.focusedChildIndex];
            var windowSize = zoomIn ? 10 : 10000;
            currentScrollView.scrollResponderZoomTo({x: evt.nativeEvent.locationX-windowSize/2, y: evt.nativeEvent.locationY-windowSize/2, width: windowSize, height: windowSize, animated:true});
            didDoubleTap = true;
        }
        this._lastPress = {
            timestamp: now,
            locationX:evt.nativeEvent.locationX,
            locationY:evt.nativeEvent.locationY,
        };
        return didDoubleTap;
    },

    onLightboxScroll: function (evt) {
        /*
        if (evt.nativeEvent.zoomScale) {
            if (evt.nativeEvent.zoomScale == 1 && this.state.lightboxIsZoomed) {
                this.state.lightboxIsZoomed = false;
            } else if (evt.nativeEvent.zoomScale > 1 && !this.state.lightboxIsZoomed) {
                this.state.lightboxIsZoomed = true;
            }
        }
        */
        return this.props.onLightboxScroll(evt);
    },
    
    render: function() {
        var {
            isOpen,
            renderHeader,
            swipeToDismiss,
            origin,
            backgroundColor,
        } = this.props;

        var {
            isPanning,
            isAnimating,
            openVal,
            target,
        } = this.state;
        
        var lightboxOpacityStyle = {
            opacity: openVal.interpolate({inputRange: [0, 1], outputRange: [0, target.opacity]})
        };

        var handlers;
        if(swipeToDismiss) {
            handlers = this._panResponder.panHandlers;
        } else {
            handlers = null;
        }

        var verticalDragStyle = null;
        if (this.state.panDirection == 'vertical') {
            verticalDragStyle = {
                top: this.state.pan.y,
            };
            lightboxOpacityStyle.opacity = this.state.pan.y.interpolate({inputRange: [-this.state.windowHeight, 0, this.state.windowHeight], outputRange: [0, 1, 0]});
        }
        var horizontalDragStyle = {};
        if (!this.state.isAnimating) {
            horizontalDragStyle = {
                left: this.state.pan.x,
            };
        }
        var outerOpenStyle = [styles.open, {
            left:   openVal.interpolate({inputRange: [0, 1], outputRange: [origin.x, target.x]}),
            top:    openVal.interpolate({inputRange: [0, 1], outputRange: [origin.y + STATUS_BAR_OFFSET, target.y + STATUS_BAR_OFFSET]}),
            width:  openVal.interpolate({inputRange: [0, 1], outputRange: [origin.width, this.state.windowWidth]}),
            height: openVal.interpolate({inputRange: [0, 1], outputRange: [origin.height, this.state.windowHeight]}),
        }];
        var openImageStyle = {
            width:  openVal.interpolate({inputRange: [0, 1], outputRange: [origin.width, this.state.windowWidth]}),
            height: openVal.interpolate({inputRange: [0, 1], outputRange: [origin.height, this.state.windowHeight]}),
        };

        var background = (<Animated.View style={[styles.background, { backgroundColor: backgroundColor, width: this.state.windowWidth, height: this.state.windowHeight }, lightboxOpacityStyle]}></Animated.View>);
        var header = (<Animated.View style={[styles.header, {width: this.state.windowWidth}, lightboxOpacityStyle]}>{(renderHeader ?
                                                                                     renderHeader(this.close) :
                                                                                     (
                                                                                         <TouchableOpacity onPress={this.close}>
                                                                                         <Text style={styles.closeButton}>×</Text>
                                                                                         </TouchableOpacity>
                                                                                     )
        )}</Animated.View>);
        
        var children = this.props.images.map((image,key) => {
            /*
               Only display all the other images in the carousel when we're not animating.
               When we're animating, render only the single visible tile to make it easier
               to do the animations.
             */
            if (this.state.isAnimating && key != this.state.focusedChildIndex) {
                return;
            }
            var imageStyle = {
                width: openVal.interpolate({inputRange: [0, 1], outputRange: [origin.width, image.width]}),
                height: openVal.interpolate({inputRange: [0, 1], outputRange: [origin.height, image.height]}),
            };

            //This is a single image's slide.  The Animated.View handles the initial opening/expanding of the image.
            //The ScrollView is completely fullscreen after opening.
            return (
                <Animated.View style={openImageStyle} key={key}>
                  <ScrollView
                    ref={"overlay_image_slide_"+key}
                    minimumZoomScale={1}
                    maximumZoomScale={this.props.zoomScaleFactor}
                    bouncesZoom={true}
                    centerContent={true}
                    scrollEventThrottle={200}
                    onScroll={this.onLightboxScroll}
                    onTouchEnd={(evt) => {
                      if (this.props.swipeToDismiss) {
                        return;
                      }
                      this._handleDoubleTap(evt,false);
                    }}
                  >
                    <Animated.Image source={{uri:image.url}} style={imageStyle}/>
                  </ScrollView>
                </Animated.View>
            );
        });

        //Outer Animated.View is animated because of "opening/expanding" the image when you touch it.  It also handles vertical dragging.
        //Inner Animated.View can slide horizontally based on drag.
        var content = (
            <Animated.View style={[outerOpenStyle, verticalDragStyle]} {...handlers}>
              <Animated.View
                style={[{
                  position:'absolute',
                  top:0,
                  flexDirection:'row',
                },horizontalDragStyle]}
              >
                {children}
              </Animated.View>
            </Animated.View>
        );
        if(this.props.navigator) {
            return (
                <View>
                {background}
                {content}
                {header}
                </View>
            );
        }
        return (
            <Modal visible={isOpen} transparent={true}>
            {background}
            {content}
            {header}
            </Modal>
        );
    }
});

var styles = StyleSheet.create({
    background: {
        position: 'absolute',
        top: 0,
        left: 0,
        //width: this.state.windowWidth,
        //height: this.state.windowHeight,
    },
    open: {
        position: 'absolute',
        flex: 1,
        justifyContent: 'center',
        // Android pan handlers crash without this declaration:
        backgroundColor: 'transparent',
    },
    header: {
        position: 'absolute',
        top: 0,
        left: 0,
        //width: this.state.windowWidth,
        backgroundColor: 'transparent',
    },
    closeButton: {
        fontSize: 35,
        color: 'white',
        lineHeight: 40,
        width: 40,
        textAlign: 'center',
        shadowOffset: {
            width: 0,
            height: 0,
        },
        shadowRadius: 1.5,
        shadowColor: 'black',
        shadowOpacity: 0.8,
    },
});

module.exports = LightboxOverlay;
