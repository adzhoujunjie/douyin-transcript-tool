module.exports = {
  apps: [
    {
      name: 'douyin-transcript',
      script: 'src/server.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3001,
        FFMPEG_PATH: process.env.FFMPEG_PATH || '/usr/bin/ffmpeg',
        FFPROBE_PATH: process.env.FFPROBE_PATH || '/usr/bin/ffprobe'
      }
    }
  ]
};
