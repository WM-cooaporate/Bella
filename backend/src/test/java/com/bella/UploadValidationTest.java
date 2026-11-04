package com.bella;

import static org.assertj.core.api.Assertions.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.server.ResponseStatusException;

class UploadValidationTest {
 @Test void acceptsReceiptFromSignatureRatherThanClientMime(){var file=new MockMultipartFile("receipt","fake.txt","text/plain",new byte[]{'%', 'P','D','F','-','1','.','7'});assertThat(new BellaApplication.Api(null,null,".").verifyReceipt(file)).isEqualTo("pdf");}
 @Test void rejectsSpoofedReceiptMime(){var file=new MockMultipartFile("receipt","receipt.pdf","application/pdf","not a pdf".getBytes());assertThatThrownBy(()->new BellaApplication.Api(null,null,".").verifyReceipt(file)).isInstanceOf(ResponseStatusException.class);}
 @Test void acceptsProductPhotoOnlyWhenHeaderMatchesImageSignature(){byte[] png={(byte)137,80,78,71,13,10,26,10,0};var file=new MockMultipartFile("image","x.bin","application/octet-stream",png);assertThat(new BellaApplication.Api(null,null,".").verifyProductImage(file)).isEqualTo("png");}
}
