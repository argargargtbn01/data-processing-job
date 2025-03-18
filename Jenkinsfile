pipeline {
    agent any

    environment {
        // Thiết lập biến môi trường nếu cần, ví dụ:
        NODE_ENV = "dev"
    }

    stages {
        stage('Checkout') {
            steps {
                // Lấy mã nguồn từ Git repository
                git url: 'https://github.com/argargargtbn01/data-processing-job', branch: 'master'
            }
        }
        stage('Install Dependencies') {
            steps {
                // Cài đặt các package bằng npm
                sh 'npm install'
            }
        }
        stage('Build') {
            steps {
                // Build dự án NestJS
                sh 'npm run build'
            }
        }
        stage('Test') {
            steps {
                // Chạy các test (nếu dự án có test)
                sh 'npm run test'
            }
        }
        stage('Archive Artifacts') {
            steps {
                // Lưu lại artifact, ví dụ: thư mục "dist"
                archiveArtifacts artifacts: 'dist/**', fingerprint: true
            }
        }
    }
    
    post {
        success {
            echo 'Pipeline hoàn thành thành công!'
        }
        failure {
            echo 'Pipeline thất bại, kiểm tra log để xem chi tiết.'
        }
    }
}
