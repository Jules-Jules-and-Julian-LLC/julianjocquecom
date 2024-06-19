function Snake() {
	var snekFatness = 40;
	return {
		fatness: snekFatness,
		mySnek: [Point(width/2, height/2, snekFatness, snekFatness, null, false)],
		longness: 10,

		moveSpeed: 41,
		moving: "UP",

		
		update: function() {
			this.updateDs();
			var head = this.getHead();

			var newX = head.x + this.dX,
				newY = head.y + this.dY;
			var newPoint = Point(newX, newY, this.fatness, this.fatness, null, false);
			this.mySnek.push(newPoint);
			this.trimSnek();
		},

		addLength: function(lengthToAdd) {
			this.longness += lengthToAdd;
		},

		getHead: function() {
			return this.mySnek[this.mySnek.length - 1];
		},

		getLength: function() {
			return this.mySnek.length;
		},

		collidesWithTail: function() {
			var snekLength = this.getLength(),
				head = this.getHead();

			return this.mySnek.length > 1 && 
				this.mySnek.slice(0, snekLength - 1).some(function(tail) {
					return head.collides(tail);
				});
		},

		draw: function() {
			background(174, 100, 100, 1);
			this.mySnek.forEach(function(point) {
				point.draw();
			});
		},

		trimSnek: function() {
			//Note, we could also check the age of the point and remove any that are too old.
			//As is, this is fine though. Not sure if it'll break when we add more longness.
			if(this.shouldTrim()) {
				this.mySnek.splice(0, 1);
			}
		},

		isFullLength: function() {
			return this.mySnek.length === this.longness;
		},

		shouldTrim: function() {
			return this.mySnek.length > this.longness;
		},

		updateDs: function() {
			switch(this.moving) {
				case "RIGHT":
					this.dX = this.moveSpeed;
					this.dY = 0;
					break;
				case "LEFT":
					this.dX = -this.moveSpeed;
					this.dY = 0;
					break;
				case "UP":
					this.dX = 0;
					this.dY = -this.moveSpeed;
					break;
				case "DOWN":
					this.dX = 0;
					this.dY = this.moveSpeed;
					break;
			}
		},

		moveRight: function() {
			if(this.moving === "LEFT") {
				return;
			}
			this.moving = "RIGHT";
		},

		moveLeft: function() {
			if(this.moving === "RIGHT") {
				return;
			}
			this.moving = "LEFT";
		},

		moveUp: function() {
			if(this.moving === "DOWN") {
				return;
			}
			this.moving = "UP";
		},

		moveDown: function() {
			if(this.moving === "UP") {
				return;
			}
			this.moving = "DOWN";
		},

		stahp: function() {
			this.dX = 0;
			this.dY = 0;
		}
	};
}