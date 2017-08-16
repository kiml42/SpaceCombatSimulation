using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.SpaceShip
{
    public class SpaceshipRunner
    {
        private readonly IDestinationChooser _destinationChooser;
        private readonly IRocketEngineControl _engineControl;

        public SpaceshipRunner(IDestinationChooser destinationChooser, IRocketEngineControl engineControl, Rigidbody targetMarker)
        {
            _destinationChooser = destinationChooser;
            _engineControl = engineControl;
            LocationTollerance = 20;
            VelociyTollerance = 0.05f;
        }

        public float LocationTollerance { get; set; }
        public float VelociyTollerance { get; set; }

        public void RunSpaceship()
        {
            var destination = _destinationChooser.GetDestinationObject();
            var target = new PotentialTarget(destination.transform, 0);

            _engineControl.FlyToTarget(target, 0, LocationTollerance, VelociyTollerance);
        }
    }
}
