using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Pilots
{
    public class MultiTorquerTorqueAplier : ITorqueApplier, IDeactivatable
    {
        private List<Rigidbody> _torquers = new List<Rigidbody>();
        private List<Transform> _engines = new List<Transform>();
        public float TorqueMultiplier;
        public float AngularDragWhenActive;
        Rigidbody _pilot;
        private Dictionary<Transform, Vector3> _engineTorques;

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
            ProcessEngines();
            Debug.Log("vector" + vector);
            var vectorInPilotSpace =  _pilot.transform.InverseTransformVector(vector);
            Debug.Log(_pilot + " vectorInPilotSpace " + vectorInPilotSpace);
            var rotationVector = new Vector3(-vectorInPilotSpace.y, vectorInPilotSpace.x, 0);   //set z to 0 to not add spin
            Debug.Log("rotationVector" + rotationVector);

            var worldTorque = _pilot.transform.TransformVector(rotationVector).normalized;
            foreach (var torquer in _torquers)
            {
                var localSpaceVector = torquer.transform.InverseTransformVector(worldTorque).normalized;    //transform vector to torquer space
                torquer.AddRelativeTorque(TorqueMultiplier * localSpaceVector); //apply torque to torquer
            }
            foreach (var enginePair in _engineTorques)
            {
                Debug.Log(enginePair.Key + " - angle" + Vector3.Angle(enginePair.Value, rotationVector) + " mag:" + enginePair.Value.magnitude);
                Debug.Log(enginePair.Value + " - " + rotationVector);
                if (enginePair.Value.magnitude > 0.5 && Vector3.Angle(enginePair.Value, rotationVector) < 90)
                {
                    Debug.Log("activate");
                    enginePair.Key.SendMessage("TurnOn");
                } else
                {
                    enginePair.Key.SendMessage("TurnOff");
                }
            }
        }

        public void AddTorquer(Rigidbody torquer)
        {
            _torquers.Add(torquer);
            RemoveNullTorquers();
        }

        public void AddEngine(Transform engine)
        {
            _engines.Add(engine);
            ProcessEngines();
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

        private void ProcessEngines()
        {
            _engines = _engines.Where(t => t.IsValid()).Distinct().ToList();
            _engineTorques = _engines.ToDictionary(e => e, e => CalculateEngineTorqueVector(e));
        }

        private Vector3 CalculateEngineTorqueVector(Transform e)
        {
            var pilotSpaceVector = _pilot.transform.InverseTransformVector(-e.up);
            var pilotSpaceEngineLocation = _pilot.transform.InverseTransformPoint(e.position);
            var xTorque = (pilotSpaceEngineLocation.y * pilotSpaceVector.z) - (pilotSpaceEngineLocation.z * pilotSpaceVector.y);
            var yTorque = (pilotSpaceEngineLocation.x * pilotSpaceVector.z) + (pilotSpaceEngineLocation.z * pilotSpaceVector.x);
            var zTorque = (pilotSpaceEngineLocation.y * pilotSpaceVector.x) + (pilotSpaceEngineLocation.x * pilotSpaceVector.y);
            return new Vector3(xTorque, yTorque, zTorque);
        }
    }
}
