pipeline {
    agent any

    environment {
        DOCKER_IMAGE = "quang1709/data-processing-job:latest"
        DOCKER_CREDENTIALS_ID = 'quang1709-dockerhub'
        KUBE_CONFIG_ID = 'kubeconfig-credentials'
        DEPLOYMENT_NAME = 'data-processing-job-kltn-service'
        DEPLOYMENT_NAMESPACE = 'argocd'
        
        // Biến môi trường Database từ Jenkins credentials
        DATABASE_HOST = credentials('DATABASE_HOST')
        DATABASE_PORT = credentials('DATABASE_PORT')
        DATABASE_USERNAME = credentials('DATABASE_USERNAME')
        DATABASE_PASSWORD = credentials('DATABASE_PASSWORD')
        DATABASE_NAME = credentials('DATABASE_NAME')
        
        // RabbitMQ Configuration
        RABBITMQ_URL = credentials('RABBITMQ_URL')
        FILE_PROCESSING_QUEUE = credentials('FILE_PROCESSING_QUEUE')
        
        // Hugging Face
        HUGGING_FACE_TOKEN = credentials('HUGGING_FACE_TOKEN')
        
        // AWS Configuration
        AWS_ACCESS_KEY_ID = credentials('AWS_ACCESS_KEY_ID')
        AWS_SECRET_ACCESS_KEY = credentials('AWS_SECRET_ACCESS_KEY')
        AWS_REGION = credentials('AWS_REGION')
        S3_BUCKET_NAME = credentials('S3_BUCKET_NAME')
    }

    stages {
        stage('Checkout Code') {
            steps {
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm install'
            }
        }

        stage('Build Application') {
            steps {
                sh 'npm run build'
            }
        }

        stage('Build Docker Image') {
            steps {
                // Tạo file .env từ biến môi trường Jenkins
                sh '''
                cat > .env << EOL
# Database Configuration
DATABASE_HOST=${DATABASE_HOST}
DATABASE_PORT=${DATABASE_PORT}
DATABASE_USERNAME=${DATABASE_USERNAME}
DATABASE_PASSWORD=${DATABASE_PASSWORD}
DATABASE_NAME=${DATABASE_NAME}

# RabbitMQ Configuration
RABBITMQ_URL=${RABBITMQ_URL}
FILE_PROCESSING_QUEUE=${FILE_PROCESSING_QUEUE}

# Hugging Face
HUGGING_FACE_TOKEN=${HUGGING_FACE_TOKEN}

# AWS Configuration
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
AWS_REGION=${AWS_REGION}
S3_BUCKET_NAME=${S3_BUCKET_NAME}
EOL
                '''
                
                // Xây dựng Docker image và copy file .env vào
                sh "docker build -t ${DOCKER_IMAGE} ."
            }
        }

        stage('Push Docker Image') {
            steps {
                withCredentials([usernamePassword(credentialsId: "${DOCKER_CREDENTIALS_ID}", usernameVariable: 'DOCKER_USERNAME', passwordVariable: 'DOCKER_PASSWORD')]) {
                    sh "echo $DOCKER_PASSWORD | docker login -u $DOCKER_USERNAME --password-stdin"
                    sh "docker push ${DOCKER_IMAGE}"
                }
            }
        }
    }

    post {
        success {
            echo 'CI/CD pipeline completed successfully!'
        }
        failure {
            echo 'CI/CD pipeline failed. Please check the logs for details.'
        }
        always {
            // Clean up to save disk space
            sh 'if [ -f ".env" ]; then rm -f .env; fi'
            sh 'docker system prune -f || true'
        }
    }
}
