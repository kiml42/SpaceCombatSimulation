using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Rocket
{
    public class MultiTorquerTorqueAplier : ITorqueApplier, IDeactivatable
    {
        private List<Rigidbody> _torquers = new List<Rigidbody>();
        public float TorqueMultiplier;
        public float AngularDragWhenActive;
        Rigidbody _pilot;

        public MultiTorquerTorqueAplier(Rigidbody pilot, Rigidbody torquer, float torqueMultiplier, float angularDragWhenActive)
        {
            _pilot = pilot;
            _torquers = new List<Rigidbody> { torquer };
            TorqueMultiplier = torqueMultiplier;
            AngularDragWhenActive = angularDragWhenActive;
        }

        public MultiTorquerTorqueAplier(Rigidbody pilotAndTorquer, float torqueMultiplier, float angularDragWhenActive)
        {
            _pilot = pilotAndTorquer;
            _torquers = new List<Rigidbody> { pilotAndTorquer };
            TorqueMultiplier = torqueMultiplier;
            AngularDragWhenActive = angularDragWhenActive;
        }

        public MultiTorquerTorqueAplier(Rigidbody pilot, List<Rigidbody> torquers, float torqueMultiplier, float angularDragWhenActive)
        {
            _pilot = pilot;
            _torquers = torquers;
            TorqueMultiplier = torqueMultiplier;
            AngularDragWhenActive = angularDragWhenActive;
        }

        public void TurnToVectorInWorldSpace(Vector3 vector)
        {
            RemoveNullTorquers();
            var vectorInPilotSpace =  _pilot.transform.InverseTransformVector(vector).normalized;
            var rotationVector = new Vector3(-vectorInPilotSpace.y, vectorInPilotSpace.x, 0);   //set z to 0 to not add spin

            var worldTorque = _pilot.transform.TransformVector(rotationVector).normalized;
            foreach (var torquer in _torquers)
            {
                var localSpaceVector = torquer.transform.InverseTransformVector(worldTorque).normalized;    //transform vector to torquer space
                torquer.AddRelativeTorque(TorqueMultiplier * localSpaceVector); //apply torque to torquer
            }
        }

        public void AddTorquer(Rigidbody torquer)
        {
            RemoveNullTorquers();
            _torquers.Add(torquer);
        }

        public void Activate()
        {
            RemoveNullTorquers();
            foreach (var torquer in _torquers)
            {
                torquer.angularDrag = AngularDragWhenActive;
            }
        }

        public void Deactivate()
        {
            RemoveNullTorquers();
            foreach (var torquer in _torquers)
            {
                torquer.angularDrag = 0;
            }
        }

        private void RemoveNullTorquers()
        {
            _torquers = _torquers.Where(t => t != null).Distinct().ToList();
        }
    }
}
