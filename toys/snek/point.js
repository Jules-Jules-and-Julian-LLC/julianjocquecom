function Point(givenX, givenY, width, height, initialColor, isStatic) {
	return {
		x: givenX,
		y: givenY,
		w: width,
		h: height,
		initC: initialColor,
		staticColor: isStatic,
		c: initialColor || color(360, 100, 50, 1),
		age: 0,

		draw: function() {
			if(!this.staticColor) {
				this.updateColor();	
			}
			fill(this.c);
			ellipse(this.x, this.y, this.w, this.h);
			this.age++;
		},

		updateColor: function() {
			var h = hue(this.c);

			h = (this.age * frameRate() / 120) % 360;
			this.c = color(h, 100, 100, 1);
		},

		//circular collides. Assumes both points are perfect circles, not oblong ellipses
		collides: function(otherPoint) {
			var run = otherPoint.x - this.x,
				rise = otherPoint.y - this.y,
				distance = Math.sqrt(run * run + rise * rise);

			return distance <= (this.w / 2) + (otherPoint.w / 2);
		},

		//http://stackoverflow.com/questions/306316/determine-if-two-rectangles-overlap-each-other
		boxCollides: function(otherPoint) {
			var wiggleroom = 2,
			 	myX1 = this.x - (this.w / wiggleroom),
				myY1 = this.y - (this.h / wiggleroom),
				myX2 = this.x + (this.w / wiggleroom),
				myY2 = this.y + (this.h / wiggleroom),
				otherX1 = otherPoint.x - (otherPoint.w / wiggleroom),
				otherY1 = otherPoint.y - (otherPoint.h / wiggleroom),
				otherX2 = otherPoint.x + (otherPoint.w / wiggleroom),
				otherY2 = otherPoint.y + (otherPoint.h / wiggleroom);

			return myX1 < otherX2 && myX2 > otherX1 && myY1 < otherY2 && myY2 > otherY1;
		}
	};
};
