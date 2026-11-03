FROM php:8.3-apache

RUN docker-php-ext-install pdo_mysql \
    && a2enmod rewrite headers

ENV APACHE_DOCUMENT_ROOT=/var/www/html
ENV BELLA_STORAGE_PATH=/var/lib/bella

COPY frontend/ /var/www/html/
COPY backend/ /var/www/backend/
COPY deploy/apache-bella.conf /etc/apache2/sites-available/000-default.conf

RUN mkdir -p /var/lib/bella/receipts /var/lib/bella/product-images \
    && chown -R www-data:www-data /var/lib/bella \
    && chown -R www-data:www-data /var/www/backend

EXPOSE 80
