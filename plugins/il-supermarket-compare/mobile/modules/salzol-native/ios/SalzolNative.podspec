Pod::Spec.new do |s|
  s.name           = 'SalzolNative'
  s.version        = '0.1.0'
  s.summary        = 'Bridges the salzol Go sync engine to the app'
  s.description    = 'Downloads and parses Israeli supermarket price files on the device (Go, built with gomobile).'
  s.author         = ''
  s.homepage       = 'https://github.com/Chaim12345/claude-plugins'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  # Built by mobile/scripts/build-go.sh (gomobile bind -target=ios).
  s.vendored_frameworks = 'Frameworks/Salzol.xcframework'
  s.source_files = 'src/**/*.swift'
end
