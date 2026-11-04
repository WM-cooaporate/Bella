package com.bella;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.context.ActiveProfiles;

@ActiveProfiles("test")
@SpringBootTest @AutoConfigureMockMvc
class BellaApiIntegrationTest {
 @DynamicPropertySource static void testProperties(DynamicPropertyRegistry r){r.add("server.servlet.session.cookie.secure",()->"false");r.add("server.servlet.session.cookie.same-site",()->"lax");r.add("bella.reservation-cleanup-ms",()->"3600000");}
 @Autowired MockMvc mvc; @Autowired JdbcTemplate db;
 long productId;
 @BeforeEach void clean(){db.update("DELETE FROM payments");db.update("DELETE FROM order_items");db.update("DELETE FROM orders");db.update("DELETE FROM products");db.update("DELETE FROM admins");productId=db.queryForObject("INSERT INTO products(name,description,price,stock_quantity) VALUES('Test item','fixture',12.50,4) RETURNING id",Long.class);}
 @Test void createsOrderReservesStockAndTrackingRequiresPhone() throws Exception {mvc.perform(get("/api/products")).andExpect(status().isOk()).andExpect(jsonPath("$.data[0].name").value("Test item"));mvc.perform(post("/api/orders").contentType(MediaType.APPLICATION_JSON).content("{\"customer_name\":\"Ada\",\"phone\":\"01012345678\",\"address\":\"Cairo\",\"product_id\":"+productId+",\"quantity\":2}")).andExpect(status().isOk()).andExpect(jsonPath("$.data.order_number").exists());org.assertj.core.api.Assertions.assertThat(db.queryForObject("SELECT stock_quantity FROM products WHERE id=?",Integer.class,productId)).isEqualTo(2);String number=db.queryForObject("SELECT order_number FROM orders",String.class);mvc.perform(post("/api/orders/status").contentType(MediaType.APPLICATION_JSON).content("{\"order_number\":\""+number+"\",\"phone\":\"01012345678\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.data.order_status").value("PENDING_PAYMENT"));}
 @Test void adminMutationsRequireSessionAndCsrf() throws Exception {mvc.perform(get("/api/admin/payments")).andExpect(status().isUnauthorized());mvc.perform(post("/api/admin/logout")).andExpect(status().isUnauthorized());}
 @Test void rejectsOutOfRangeOrderQuantityWithoutChangingStock() throws Exception {mvc.perform(post("/api/orders").contentType(MediaType.APPLICATION_JSON).content("{\"customer_name\":\"Ada\",\"phone\":\"01012345678\",\"address\":\"Cairo\",\"product_id\":"+productId+",\"quantity\":101}")).andExpect(status().isUnprocessableEntity());org.assertj.core.api.Assertions.assertThat(db.queryForObject("SELECT stock_quantity FROM products WHERE id=?",Integer.class,productId)).isEqualTo(4);}
}
