import React, { Component } from 'react';
import Hls from 'hls.js';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';

import Loader from 'components/loader/loader-component';
import VideoControls from 'containers/video-player/video-controls/video-controls-component';
import TextTrack from 'containers/video-player/text-track/text-track-component';

import { togglePlayer } from 'stores/app';
import { createStream, updateStreamTime, resetStream } from 'stores/stream';
import { toggleFileBrowserDialog } from 'stores/file-browser';
import { resetTextTrack } from 'stores/text-track';

import { VideoContainer } from './web-player-styles';

class WebPlayer extends Component {
  constructor(props) {
    super(props);

    this.state = {
      isLoading: false,
      isPaused: false,
      isMuted: false,
      isControlsVisible: true,
      isTextTrackEnabled: false,
      volume: 1,
      currTimeOffset: 0
    };
  
    this.initHls = this.initHls.bind(this);
    this.togglePlay = this.togglePlay.bind(this);
    this.showControls = this.showControls.bind(this);
    this.hideControls = this.hideControls.bind(this);
    this.onVideoMouseMove = this.onVideoMouseMove.bind(this);
    this.seek = this.seek.bind(this);
    this.onVideoPlaying = this.onVideoPlaying.bind(this);
    this.onVideoPaused = this.onVideoPaused.bind(this);
    this.onVideoTimeUpdate = this.onVideoTimeUpdate.bind(this);
    this.onVideoEnded = this.onVideoEnded.bind(this);
    this.changeVolume = this.changeVolume.bind(this);
    this.toggleMute = this.toggleMute.bind(this);
    this.toggleFullscreen = this.toggleFullscreen.bind(this);
    this.stopTimer = this.stopTimer.bind(this);
    this.cleanup = this.cleanup.bind(this);
  }

  componentDidMount() {
    const { stream } = this.props;
    if (stream.id !== '' && !stream.hasError) this.initHls();
  }

  componentWillUnmount() {
    if (this.hls) this.hls.destroy();
    if (this.timerId !== undefined) this.stopTimer();
  }
  
  initHls() {
    const { video } = this;
    const { stream } = this.props;

    this.hls = new Hls({ 
      debug: true,
      maxBufferLength: 10, /* in seconds */
      maxBufferSize: 30 * 1000 * 1000, /* Chrome max buffer size 150MB */
      manifestLoadingMaxRetry: 3,
      manifestLoadingTimeOut: 20000 /* 20 seconds before timeout callback is fired */
    });
    this.hls.attachMedia(video);
    // load source when hls is attached to video element
    this.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      this.setState({ isLoading: true, isTextTrackEnabled: false }, () => {
        this.hls.loadSource(`/api/stream/video/${stream.id}/playlist.m3u8`);
      });
    });
    this.hls.on(Hls.Events.MANIFEST_PARSED, (evt, data) => {
      this.setState({ isLoading: false, isTextTrackEnabled: true }, () => video.play());
    });
    // hls error handling
    this.hls.on(Hls.Events.ERROR, (evt, data) => { 
      if (data.fatal) {
        switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          console.log('Trying to recover from fatal network error');
          return this.hls.startLoad();
        case Hls.ErrorTypes.MEDIA_ERROR:
          console.log('Trying to recover from fatal media error');
          return this.hls.recoverMediaError();
        default:
          console.log('Unable to recover from fatal error');
          return this.hls.destroy();
        }
      }
    });
  }

  togglePlay(e) {
    e.preventDefault();
    const { video } = this;

    if (video.paused) this.setState({ isPaused: false }, () => video.play());
    else this.setState({ isPaused: true }, () => video.pause());
  }

  showControls(e) {
    const { isControlsVisible } = this.state;
    if (e) e.stopPropagation();
    if (typeof this.timerId === 'number') this.stopTimer();
    if (!isControlsVisible) this.setState({ isControlsVisible: true });
  }

  hideControls() {
    const { isControlsVisible } = this.state;
    if (isControlsVisible) this.setState({ isControlsVisible: false });
  }

  onVideoMouseMove(e) {
    const { app } = this.props;
    if (app.isPlayerEnabled) this.showControls(); // show controls

    this.timerId = setTimeout(this.hideControls, 4000);
  }

  seek(seekTime) {
    const { stream, createStream } = this.props;

    if (this.hls) this.hls.destroy(); // destroy current hls stream

    this.setState({ currTimeOffset: seekTime }, () => {
      createStream(stream.video, seekTime).then(() => {
        if (!stream.hasError) this.initHls();
      });
    });
  }

  onVideoPlaying() {
    const { isPaused } = this.state;
    if (isPaused) this.setState({ isPaused: false });
  }

  onVideoPaused() {
    const { isPaused } = this.state;
    if (!isPaused) this.setState({ isPaused: true });
  }

  onVideoTimeUpdate() {
    const { updateStreamTime } = this.props;
    const { isControlsVisible, currTimeOffset } = this.state;
    const { video } = this;

    if (isControlsVisible) updateStreamTime(video.currentTime + currTimeOffset);
  }

  onVideoEnded() {
    console.log('the video has ended');
    return this.cleanup();
  }

  changeVolume(e) {
    const { video } = this;
    const volume = parseFloat(e.target.value);

    this.setState({ volume }, () => video.volume = volume);
  }

  toggleMute() {
    const { isMuted } = this.state;
    const { video } = this;

    this.setState({ isMuted: !isMuted }, () => video.muted = !isMuted);
  }

  toggleFullscreen(e) {
    const { app } = this.props;
    const rootNode = document.querySelector('#root');

    const requestFullscreen = rootNode.requestFullscreen ||
                              rootNode.mozRequestFullScreen ||
                              rootNode.webkitRequestFullScreen ||
                              rootNode.msRequestFullscreen;

    const exitFullscreen = document.exitFullscreen ||
                           document.mozCancelFullScreen ||
                           document.webkitCancelFullScreen ||
                           document.msExitFullscreen;

    /*
    use call to bind to the video container when invoked
    bind to the #root node instead of the video itself
    to enable custom controls in fullscreen mode
    */
    if (!app.isFullscreenEnabled) requestFullscreen.call(rootNode);
    else exitFullscreen.call(document);
  }

  stopTimer() { 
    clearTimeout(this.timerId);
    this.timerId = undefined;
  }

  cleanup() {
    const { app, stream, togglePlayer, resetStream, resetTextTrack } = this.props;
    if (this.hls) this.hls.destroy();

    const method = 'post';
    const headers = new Headers();
    const body = JSON.stringify({ id: stream.id });
    headers.append('Content-Type', 'application/json');

    fetch('/api/stream/terminate', { method, headers, body });

    if (app.isFullscreenEnabled) this.toggleFullscreen();
    this.stopTimer();
    resetStream();
    resetTextTrack();
    togglePlayer();
  }
  
  render() {
    const { app, stream, toggleFileBrowserDialog } = this.props;
    const { isLoading, isPaused, isMuted, isControlsVisible, isTextTrackEnabled, volume, currTimeOffset } = this.state;

    if (stream.hasError) {
      return (
        <VideoContainer className='flex flex-center absolute'>
          <span style={{color: 'white'}}>Something went wrong...</span>
        </VideoContainer>
      );
    }

    return (
      <VideoContainer
        id='video-player'
        className='flex flex-center absolute'
        onMouseMove={this.onVideoMouseMove}
      >
        {isLoading ? <Loader size={42} /> : null}
        <video
          autoPlay={true}
          playsInline={true}
          width='100%'
          height='100%'
          crossOrigin='anonymous'
          onPlaying={this.onVideoPlaying}
          onPause={this.onVideoPaused}
          onTimeUpdate={this.onVideoTimeUpdate}
          onEnded={this.onVideoEnded}
          ref={(el) => this.video = el}
        >
          <TextTrack currTimeOffset={currTimeOffset} isTextTrackEnabled={isTextTrackEnabled}/>
        </video>
        <VideoControls
          seek={this.seek}
          toggleFileBrowserDialog={toggleFileBrowserDialog}
          togglePlay={this.togglePlay}
          toggleMute={this.toggleMute}
          toggleFullscreen={this.toggleFullscreen}
          changeVolume={this.changeVolume}
          cleanup={this.cleanup}
          isControlsVisible={isControlsVisible}
          isPaused={isPaused}
          isMuted={isMuted}
          isFullscreenEnabled={app.isFullscreenEnabled}
          volume={volume}
          currentTime={stream.currentTime}
          duration={stream.duration}
        />
      </VideoContainer>
    );
  }
}

const mapStateToProps = (state) => ({ 
  app: state.app,
  stream: state.stream
});

const mapDispatchToProps = (dispatch) => ({ 
  createStream: bindActionCreators(createStream, dispatch),
  togglePlayer: bindActionCreators(togglePlayer, dispatch),
  toggleFileBrowserDialog: bindActionCreators(toggleFileBrowserDialog, dispatch),
  updateStreamTime: bindActionCreators(updateStreamTime, dispatch),
  resetStream: bindActionCreators(resetStream, dispatch),
  resetTextTrack: bindActionCreators(resetTextTrack, dispatch)
});

export default connect(mapStateToProps, mapDispatchToProps)(WebPlayer);
