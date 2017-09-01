using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.SpaceShip
{
    public class AverageTargetLocationDestinationChooser : IDestinationChooser
    {
        private readonly ITargetDetector _detector;
        private Rigidbody _destination;

        public AverageTargetLocationDestinationChooser(ITargetDetector detector, Rigidbody destination)
        {
            _detector = detector;
            _destination = destination;

        }

        public Rigidbody GetDestinationObject()
        {
            var targets = _detector
                .DetectTargets()
                .Select(t => t.TargetRigidbody.GetComponent("Rigidbody") as Rigidbody)
                .Where(t => t != null);

            //Vector3 locationSum = SumVecors(targets.Select(t => t.position));
            if (targets.Any())
            {
                var averageXLocation = targets.Average(t => t.position.x);
                var averageYLocation = targets.Average(t => t.position.y);
                var averageZLocation = targets.Average(t => t.position.z);
                _destination.position = new Vector3(averageXLocation, averageYLocation, averageZLocation);

                var averageXVelocity = targets.Average(t => t.velocity.x);
                var averageYVelocity = targets.Average(t => t.velocity.y);
                var averageZVelocity = targets.Average(t => t.velocity.z);
                _destination.velocity = new Vector3(averageXVelocity, averageYVelocity, averageZVelocity);
            }
            else
            {
                _destination.position = Vector3.zero;
                _destination.velocity = Vector3.zero;
            }
            return _destination;

        }

        //private Vector3 SumVecors(IEnumerable<Vector3> enumerable)
        //{
        //    var vector = 0;
        //    foreach (var item in collection)
        //    {

        //    }
        //}
    }
}
