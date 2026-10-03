# Built by `cdk deploy` (server/infra) from the jar produced by `gradlew :app:bootJar`.
FROM eclipse-temurin:17-jre-alpine
RUN addgroup -S app && adduser -S app -G app
USER app
WORKDIR /app
COPY build/libs/app.jar app.jar
EXPOSE 8080
# 0.5 GB task: heap capped so the JVM, threads and metaspace fit; SerialGC is the lean choice for one vCPU share.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=60", "-XX:+UseSerialGC", "-jar", "/app/app.jar"]
