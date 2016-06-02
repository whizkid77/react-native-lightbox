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

var WINDOW_HEIGHT = Dimensions.get('window').height;
var WINDOW_WIDTH = Dimensions.get('window').width;
var DRAG_DISMISS_THRESHOLD = 150;
var STATUS_BAR_OFFSET = (Platform.OS === 'android' ? -25 : 0);

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

    componentWillMount: function() {
        this._panResponder = PanResponder.create({
            // Ask to be the responder:
            onStartShouldSetPanResponder: (evt, gestureState) => !this.state.isAnimating,
            onStartShouldSetPanResponderCapture: (evt, gestureState) => !this.state.isAnimating,
            onMoveShouldSetPanResponder: (evt, gestureState) => !this.state.isAnimating,
            onMoveShouldSetPanResponderCapture: (evt, gestureState) => !this.state.isAnimating,
            onPanResponderGrant: (evt, gestureState) => {
                this.state.pan.y.setValue(0);
                this.setState({ isPanning: true });
            },
            onPanResponderMove: (evt, gestureState) => {
                if (!this.state.panDirection) {
                    if (Math.abs(gestureState.dx) > Math.abs(gestureState.dy)) {
                        this.setState({panDirection:'horizontal'});
                    } else {
                        this.setState({panDirection:'vertical'});
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
                if(this.state.panDirection == 'vertical' && Math.abs(gestureState.dy) > DRAG_DISMISS_THRESHOLD) {
                    this.setState({
                        isPanning: false,
                        panDirection: null,
                        target: {
                            y: gestureState.dy,
                            x: gestureState.dx,
                            opacity: 1 - Math.abs(gestureState.dy / WINDOW_HEIGHT)
                        },
                    });
                    this.close();
                } else {
                    if (this.state.panDirection == 'vertical') {
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
                        var NEXT_CHILD_OFFSET_THRESHOLD = Math.max(WINDOW_WIDTH * 0.2,50);
                        var NEXT_CHILD_VELOCITY_THRESHOLD = 1;
                        var targetOffset = null;
                        if ((gestureState.dx < -1 * NEXT_CHILD_OFFSET_THRESHOLD
                          || gestureState.vx < -1 * NEXT_CHILD_VELOCITY_THRESHOLD)
                                && this.state.focusedChildIndex < this.props.children.length-1
                        ) {
                            //Move to the next child
                            targetOffset = -1 * WINDOW_WIDTH;
                            this.state.focusedChildIndex += 1;
                        }
                        else if ((gestureState.dx > NEXT_CHILD_OFFSET_THRESHOLD
                               || gestureState.vx > NEXT_CHILD_VELOCITY_THRESHOLD)
                                && this.state.focusedChildIndex > 0
                        ) {
                            //Move to the previous child
                            targetOffset = WINDOW_WIDTH;
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
                }
            },
        });
    },

    componentDidMount: function() {
        if(this.props.isOpen) {
            this.open();
        }
    },

    open: function() {
        StatusBar.setHidden(true, 'fade');

        this.state.pan.x.setValue(0);
        this.state.carouselOffset = -1 * (this.state.focusedChildIndex || 0) * WINDOW_WIDTH;
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
        this.state.carouselOffset = -1 * (this.state.focusedChildIndex || 0) * WINDOW_WIDTH;
        this.state.pan.x.setOffset(this.state.carouselOffset);
        
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
        }

        var verticalDragStyle = null;
        if (this.state.panDirection == 'vertical') {
            verticalDragStyle = {
                top: this.state.pan.y,
            };
            lightboxOpacityStyle.opacity = this.state.pan.y.interpolate({inputRange: [-WINDOW_HEIGHT, 0, WINDOW_HEIGHT], outputRange: [0, 1, 0]});
        }
        var horizontalDragStyle = {
            left: this.state.pan.x,
        };
        
        var openStyle = [styles.open, {
            left:   openVal.interpolate({inputRange: [0, 1], outputRange: [origin.x, target.x]}),
            top:    openVal.interpolate({inputRange: [0, 1], outputRange: [origin.y + STATUS_BAR_OFFSET, target.y + STATUS_BAR_OFFSET]}),
            width:  openVal.interpolate({inputRange: [0, 1], outputRange: [origin.width, WINDOW_WIDTH]}),
            height: openVal.interpolate({inputRange: [0, 1], outputRange: [origin.height, WINDOW_HEIGHT]}),
        }];

        var background = (<Animated.View style={[styles.background, { backgroundColor: backgroundColor }, lightboxOpacityStyle]}></Animated.View>);
        var header = (<Animated.View style={[styles.header, lightboxOpacityStyle]}>{(renderHeader ?
                                                                                     renderHeader(this.close) :
                                                                                     (
                                                                                         <TouchableOpacity onPress={this.close}>
                                                                                         <Text style={styles.closeButton}>×</Text>
                                                                                         </TouchableOpacity>
                                                                                     )
        )}</Animated.View>);
        var content = (
            <Animated.View style={[openStyle, verticalDragStyle]} {...handlers}>
            <Animated.View
            style={[openStyle,{
                position:'absolute',
                top:0,
                flexDirection:'row',
                alignItems:'center',
                justifyContent:'flex-start',
            },horizontalDragStyle]}
            >
            {this.props.children}
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
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
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
        width: WINDOW_WIDTH,
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
